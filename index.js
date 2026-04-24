require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { createClient } = require('@supabase/supabase-js')

// === SETUP ===
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

console.log('🤖 Bot tugas aktif!')

// === FUNGSI AMBIL SEMUA TUGAS ===
async function ambilTugas() {
  const { data, error } = await supabase
    .from('tugas')
    .select('*')
    .eq('selesai', false)
    .order('deadline', { ascending: true })

  if (error) throw error
  return data || []
}

// === FUNGSI PROSES PESAN DENGAN AI ===
async function prosesPerintah(pesan) {
  const tugasList = await ambilTugas()
  const hariIni = new Date().toISOString().split('T')[0]

  const prompt = `Kamu adalah asisten pencatat tugas kuliah bernama TugasBot. Hari ini: ${hariIni}.
    
Data tugas yang belum selesai: ${JSON.stringify(tugasList)}

Tugasmu adalah memahami pesan user dan menentukan aksi yang harus dilakukan.
Balas HANYA dalam format JSON seperti ini (tanpa teks lain, tanpa markdown, tanpa backtick):
{
  "aksi": "simpan_tugas" | "list_tugas" | "deadline_dekat" | "selesai_tugas" | "hapus_tugas" | "info",
  "data": {
    "mata_kuliah": "...",
    "deskripsi": "...",
    "deadline": "YYYY-MM-DD"
  },
  "id": 123,
  "balasan": "pesan balasan ke user dalam bahasa Indonesia yang ramah dan pakai emoji"
}

Aturan:
- "simpan_tugas": kalau user menyebut tugas baru dengan deadline
- "list_tugas": kalau user minta lihat semua tugas
- "deadline_dekat": kalau user tanya tugas yang mendekati deadline (dalam 7 hari)
- "selesai_tugas": kalau user bilang tugas sudah selesai/dikerjakan (isi id tugas yang dimaksud)
- "hapus_tugas": kalau user minta hapus tugas (isi id tugas yang dimaksud)
- "info": kalau pesan tidak berhubungan dengan tugas

Untuk balasan list_tugas dan deadline_dekat, tampilkan tugas dengan format yang rapi pakai emoji.
Jika tidak ada tugas, beritahu dengan ramah.

Pesan user: ${pesan}`

  const result = await model.generateContent(prompt)
  let teks = result.response.text().trim()
  teks = teks.replace(/```json|```/g, '').trim()
  return JSON.parse(teks)
}

// === HANDLE PESAN MASUK ===
bot.on('message', async (msg) => {
  const chatId = msg.chat.id
  const teks = msg.text

  if (!teks) return

  if (teks === '/start') {
    bot.sendMessage(chatId, `👋 Halo! Saya *TugasBot*, asisten pencatat tugas kuliah kamu!

Kamu bisa chat natural ke saya, contoh:

📝 *Simpan tugas:*
"Tugas Alpro bikin program sorting deadline 30 April"

📋 *Lihat semua tugas:*
"List semua tugas"

⏰ *Cek deadline dekat:*
"Tugas apa yang deadline-nya dekat?"

✅ *Tandai selesai:*
"Tugas Alpro sudah selesai"

🗑️ *Hapus tugas:*
"Hapus tugas nomor 3"`, { parse_mode: 'Markdown' })
    return
  }

  bot.sendChatAction(chatId, 'typing')

  try {
    const hasil = await prosesPerintah(teks)

    if (hasil.aksi === 'simpan_tugas' && hasil.data) {
      const { error } = await supabase.from('tugas').insert([{
        mata_kuliah: hasil.data.mata_kuliah,
        deskripsi: hasil.data.deskripsi,
        deadline: hasil.data.deadline
      }])
      if (error) throw error

    } else if (hasil.aksi === 'selesai_tugas' && hasil.id) {
      const { error } = await supabase
        .from('tugas')
        .update({ selesai: true })
        .eq('id', hasil.id)
      if (error) throw error

    } else if (hasil.aksi === 'hapus_tugas' && hasil.id) {
      const { error } = await supabase
        .from('tugas')
        .delete()
        .eq('id', hasil.id)
      if (error) throw error
    }

    bot.sendMessage(chatId, hasil.balasan)

  } catch (err) {
    console.error('Error:', err)
    bot.sendMessage(chatId, '⚠️ Maaf, ada error. Coba lagi ya!')
  }
})