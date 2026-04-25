require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api')
const Groq = require('groq-sdk')
const { Pool } = require('pg')

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true })
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

console.log('🤖 Bot tugas aktif!')

async function ambilTugas(userId) {
  const result = await pool.query(
    'SELECT * FROM tugas WHERE selesai = FALSE AND user_id = $1 ORDER BY deadline ASC',
    [userId]
  )
  return result.rows
}

async function prosesPerintah(pesan, userId) {
  const tugasList = await ambilTugas(userId)
  const hariIni = new Date().toISOString().split('T')[0]

  const prompt = `Kamu adalah asisten pencatat tugas kuliah bernama TugasBot. Hari ini: ${hariIni}.
Data tugas yang belum selesai: ${JSON.stringify(tugasList)}

Balas HANYA dalam format JSON (tanpa teks lain, tanpa markdown, tanpa backtick):
{
  "aksi": "simpan_tugas|list_tugas|deadline_dekat|selesai_tugas|hapus_tugas|info",
  "tugas_list": [
    {
      "mata_kuliah": "...",
      "deskripsi": "...",
      "deadline": "YYYY-MM-DD"
    }
  ],
  "id": 123,
  "balasan": "pesan balasan ramah pakai emoji"
}

Aturan aksi:
- simpan_tugas: ada tugas baru dengan deadline, tugas_list bisa berisi LEBIH DARI SATU tugas sekaligus
- list_tugas: minta lihat semua tugas
- deadline_dekat: tanya tugas mendekati deadline 7 hari
- selesai_tugas: tugas sudah selesai, isi id
- hapus_tugas: minta hapus tugas, isi id
- info: tidak berhubungan dengan tugas

Format balasan untuk list_tugas dan deadline_dekat harus rapi seperti ini:
📚 Tugas kamu saat ini:

1. [mata_kuliah]
   📝 [deskripsi]
   ⏰ Deadline: [tanggal dalam format DD MMMM YYYY]
   🆔 ID: [id]

Untuk simpan_tugas, konfirmasi tugas yang berhasil disimpan dengan format:
✅ Berhasil menyimpan [jumlah] tugas:
1. [mata_kuliah] - [deskripsi] (deadline: DD MMMM YYYY)
2. dst...

Pesan user: ${pesan}`

  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3
  })
  let teks = result.choices[0].message.content.trim()
  teks = teks.replace(/```json|```/g, '').trim()
  return JSON.parse(teks)
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const teks = msg.text
  if (!teks) return

  if (teks === '/start') {
    bot.sendMessage(chatId, `👋 Halo *${msg.from.first_name}*! Saya *TugasBot*, asisten pencatat tugas kuliah kamu!

Kamu bisa chat natural ke saya, contoh:

📝 *Simpan 1 tugas:*
"Tugas Alpro bikin program sorting deadline 30 April"

📝 *Simpan banyak tugas sekaligus:*
"Tugas PAA dan PPL praktikum deadline 27 Mei"

📋 *Lihat semua tugas:*
"Apa saja tugasku sekarang?"

⏰ *Cek deadline dekat:*
"Tugas mana yang paling urgent?"

✅ *Tandai selesai:*
"Tugas Alpro sudah selesai"

🗑️ *Hapus tugas:*
"Hapus tugas nomor 3"`, { parse_mode: 'Markdown' })
    return
  }

  bot.sendChatAction(chatId, 'typing')

  try {
    const hasil = await prosesPerintah(teks, userId)

    if (hasil.aksi === 'simpan_tugas' && hasil.tugas_list && hasil.tugas_list.length > 0) {
      for (const t of hasil.tugas_list) {
        await pool.query(
          'INSERT INTO tugas (user_id, mata_kuliah, deskripsi, deadline) VALUES ($1, $2, $3, $4)',
          [userId, t.mata_kuliah, t.deskripsi, t.deadline]
        )
      }
    } else if (hasil.aksi === 'selesai_tugas' && hasil.id) {
      await pool.query(
        'UPDATE tugas SET selesai = TRUE WHERE id = $1 AND user_id = $2',
        [hasil.id, userId]
      )
    } else if (hasil.aksi === 'hapus_tugas' && hasil.id) {
      await pool.query(
        'DELETE FROM tugas WHERE id = $1 AND user_id = $2',
        [hasil.id, userId]
      )
    }

    bot.sendMessage(chatId, hasil.balasan)
  } catch (err) {
    console.error('Error:', err)
    bot.sendMessage(chatId, '⚠️ Maaf, ada error. Coba lagi ya!')
  }
})