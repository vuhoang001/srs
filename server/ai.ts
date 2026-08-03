import Anthropic from '@anthropic-ai/sdk'

// Sinh thẻ học từ một đoạn văn bản bằng Claude. Tra cuu tai lieu API (claude-api skill)
// -> dung @anthropic-ai/sdk, structured output (output_config.format json_schema),
// khong can streaming, mac dinh model claude-opus-4-8 (nguoi dung doi duoc).

export type GenCard = { front: string; back: string; tags: string }

// Structured output: khong dat rang buoc so luong/do dai trong schema (khong ho tro) -> nhac trong prompt
const SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          tags: { type: 'string' },
        },
        required: ['front', 'back', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

// Cho phep vai model tot; mac dinh Opus 4.8 (khong tu ha cap vi chi phi — de nguoi dung chon)
export const AI_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']

export async function generateCards(
  opts: { text: string; model?: string; count?: number; avoid?: string[] },
): Promise<GenCard[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Chưa có ANTHROPIC_API_KEY. Đặt biến môi trường này rồi khởi động lại server để dùng AI.')
  }
  const text = (opts.text || '').trim()
  if (text.length < 10) throw new Error('Nội dung quá ngắn để tạo thẻ.')
  const model = opts.model && AI_MODELS.includes(opts.model) ? opts.model : 'claude-opus-4-8'
  const count = Math.min(50, Math.max(1, opts.count || 15))

  // Cac cau hoi da co trong kho -> nhac Claude KHONG sinh trung (khu trung ngu nghia).
  // Cat bot cho gon token: toi da ~300 cau, moi cau <=200 ky tu.
  const avoid = (opts.avoid || []).map((s) => s.slice(0, 200)).filter(Boolean).slice(0, 300)
  const avoidBlock = avoid.length
    ? `\n\nKho đã CÓ SẴN các câu hỏi sau — TUYỆT ĐỐI không tạo lại chúng hay bản diễn đạt khác cùng ý:\n` +
      avoid.map((q, i) => `${i + 1}. ${q}`).join('\n')
    : ''

  const client = new Anthropic()
  const system =
    `Bạn tạo thẻ học (flashcard) chất lượng cao cho ứng dụng lặp lại ngắt quãng, từ nội dung người dùng đưa.
Tạo tối đa ${count} thẻ MỚI. Nguyên tắc:
- Mỗi thẻ hỏi MỘT ý. Mặt trước là câu hỏi rõ ràng; mặt sau là câu trả lời ngắn gọn, chính xác.
- Ưu tiên khái niệm, định nghĩa, quan hệ nhân–quả, con số/điều kiện quan trọng.
- KHÔNG bịa thông tin ngoài nội dung. KHÔNG tạo hai thẻ trùng ý.
- 'tags' là vài từ khoá ngắn cách nhau bởi dấu cách (có thể để rỗng).
- Viết cùng ngôn ngữ với nội dung nguồn.
- Nếu nội dung không còn ý mới nào (ngoài các câu đã có), trả về mảng cards rỗng.${avoidBlock}`

  // output_config chua chac co trong type cua ban SDK dang cai -> cast de tsc khong bao loi (API van nhan)
  const res: any = await client.messages.create({
    model,
    max_tokens: 16000,
    system,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: text }],
  } as any)

  if (res.stop_reason === 'refusal') throw new Error('Mô hình từ chối tạo thẻ cho nội dung này.')
  const block = (res.content || []).find((b: any) => b.type === 'text')
  const raw = block?.text || ''
  let parsed: any
  try { parsed = JSON.parse(raw) } catch { throw new Error('Không đọc được kết quả từ mô hình.') }
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : []
  return cards
    .filter((c: any) => c && c.front && c.back)
    .map((c: any) => ({ front: String(c.front), back: String(c.back), tags: String(c.tags || '') }))
}
