# srs-app — app ôn tập lặp lại ngắt quãng (FSRS)

App học của riêng bạn, thay cho Anki. Dùng thuật toán **FSRS** (`ts-fsrs` — cùng bộ não Anki
đời mới dùng) để lập lịch ôn, lưu trong **SQLite**, có **web UI** để ôn và quản lý thẻ.

Dự án này tách khỏi kho `knowledge`: kho vẫn là **nguồn nội dung**, app này giữ **tiến trình học**.

## Chạy

```bash
npm install
npm run import      # (tuỳ chọn) nhập thẻ từ ../knowledge/anki/*.tsv
npm run dev         # mở http://localhost:5173
```

`npm run dev` chạy đồng thời API (cổng 3001) và web (cổng 5173, tự proxy `/api` sang 3001).
Bản build tĩnh: `npm run build` rồi `npm start` (một cổng 3001 phục vụ cả app lẫn API).

## Nhập dữ liệu — ba đường

1. **Từ kho knowledge:** `npm run import` đọc `../knowledge/anki/*.tsv`. Đổi đường dẫn bằng
   `KB_DIR=/path/to/anki npm run import`.
2. **Excel / CSV / TSV:** trong web → tab **Quản lý** → **Import** → chọn file. File cần dòng
   tiêu đề có cột `front` và `back` (chấp nhận `câu hỏi`/`đáp án`); cột tuỳ chọn `tags`, `deck`,
   `id`. File được đọc ngay trong trình duyệt (SheetJS), không upload đi đâu.
3. **Nhập tay:** tab **Quản lý** → **+ Thẻ**.

## Vì sao sửa nội dung không mất tiến trình

Hai bảng tách bạch: `card` (nội dung) và `state` (tiến trình FSRS). Mỗi thẻ có `guid` ổn định,
**không suy từ mặt trước**. Sửa mặt trước/sau trong app giữ nguyên `guid` → `state` không đụng
tới. Muốn re-import từ file mà vẫn khớp thẻ cũ dù đã sửa mặt trước: thêm cột **`id`** vào file.

## Backend API (để quản lý bằng script/công cụ khác)

Toàn bộ là REST/JSON ở `http://localhost:3001`.

| Method | Đường dẫn | Việc |
|---|---|---|
| GET | `/api/next` | Thẻ kế tiếp. Tham số `deck`, `tag`, `mode` (flash·quiz·**type**), `dir` (fwd·**rev**·both). Ưu tiên: thẻ đang học lại trong buổi → thẻ cũ đến hạn → thẻ mới |
| POST | `/api/review` | `{guid, rating}` (1 Again·2 Hard·3 Good·4 Easy) → FSRS lập lịch lại |
| POST | `/api/optimize` | Học 19 tham số FSRS riêng từ `review_log` (cần đủ dữ liệu) → lưu vào settings `w` |
| POST | `/api/optimize/reset` | Bỏ tham số riêng, về mặc định |
| POST | `/api/reschedule` | Tính lại lịch mọi thẻ Review theo tham số hiện tại (không đổi lịch sử) |
| GET/POST | `/api/ai/status` · `/api/generate` | AI sinh thẻ từ văn bản (`{text, model?, count?}` → `{cards}`). Cần `ANTHROPIC_API_KEY` |
| POST/GET | `/api/backup` · `/api/backups` | Sao lưu SQLite (tự động mỗi 24h) + liệt kê/tải bản sao |
| GET | `/api/stats` | `{total, due}` |
| GET | `/api/cards?q=` | Danh sách/tìm thẻ (kèm `reps`, `due`) |
| POST | `/api/check-dup` | `{front, guid?}` → `{trung: [guid…]}` — "câu này có chưa" |
| POST | `/api/cards` | Thêm thẻ `{front, back, tags?, deck?}` |
| PUT | `/api/cards/:guid` | Sửa `{front?, back?, tags?, deck?}` — **giữ tiến trình** |
| DELETE | `/api/cards/:guid` | Xoá thẻ (và tiến trình của nó) |
| POST | `/api/import` | `{rows: [{front,back,tags?,deck?,id?}], deck?}` → `{them,sua,giu,trung}` |
| GET | `/api/export?format=&deck=` | Xuất CSV/JSON, lọc theo `deck` nếu có (tên file theo deck) |
| POST | `/api/decks/rename` · `/api/decks/delete` | `{from,to}` gộp/đổi tên deck · `{deck}` xoá cả deck |

Ví dụ thêm thẻ bằng `curl`:

```bash
curl -s localhost:3001/api/cards -H 'content-type: application/json' \
  -d '{"front":"Grain là gì?","back":"Một dòng đại diện cho cái gì","deck":"Data Modeling"}'
```

## Cài đặt (⚙ trong app)

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `new_per_day` | 20 | Số thẻ **mới** đưa ra ôn mỗi ngày |
| `max_reviews_per_day` | 200 | Trần số lượt ôn **thẻ cũ** mỗi ngày (0 = không giới hạn) |
| `request_retention` | 0.9 | Mục tiêu tỉ lệ nhớ FSRS (0.80–0.97) — cao hơn = nhớ chắc hơn nhưng ôn nhiều hơn |
| `learn_ahead_min` | 20 | Thẻ bấm Again hiện lại trong buổi nếu đến hạn trong khoảng phút này |
| `w` | (mặc định) | 19 tham số FSRS riêng do `/api/optimize` học từ lịch sử ôn |

## AI sinh thẻ + khử trùng (tuỳ chọn)

Cần khoá API trước khi chạy server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Mặc định dùng model `claude-opus-4-8` (đổi được: opus / sonnet / haiku).

**Ba lớp chống trùng** — thẻ chỉ được thêm nếu chưa có:

1. **AI biết bạn đã có gì:** khi sinh thẻ, server gửi kèm danh sách câu hỏi hiện có (toàn kho) và
   yêu cầu Claude *không* tạo lại chúng hay bản diễn đạt khác cùng ý → chặn trùng **ngữ nghĩa**.
2. **`guid` ổn định:** mỗi thẻ có guid suy từ (deck + mặt trước). Import lại đúng câu → guid trùng →
   `unchanged` (không thêm mới).
3. **Khớp mặt trước:** import báo `trung` cho câu có mặt trước giống thẻ đã có (mọi deck).

Xem kho đang có câu nào: `GET /api/questions` (thêm `?deck=…` để lọc).

### Cách 1 — trong web

Tab **Quản lý → AI tạo thẻ**: dán tài liệu → xem trước → Import. Đã tự khử trùng toàn kho.

### Cách 2 — sinh thẳng từ một trang web (CLI)

```bash
npm run gen -- https://vuhoang001.github.io/knowledge/ "Knowledge" 20
# hoặc: node scripts/gen.mjs <url> [deck] [số-thẻ]
```

Script tải trang → tách chữ → gọi `/api/generate` (tự khử trùng) → `/api/import`, rồi in
`+N mới, … giữ nguyên, … trùng (đã bỏ qua)`. Trỏ vào **từng trang bài** cho nội dung tập trung hơn
là trang mục lục. Cần server đang chạy + có `ANTHROPIC_API_KEY`.

### Cách 3 — để Claude CLI tự làm

Mở Claude CLI trong thư mục dự án (server đang chạy) và yêu cầu, ví dụ:

> "Đọc https://vuhoang001.github.io/knowledge/…, lấy `GET localhost:3001/api/questions` xem kho đã có
> câu nào, sinh các câu **mới** chưa có, rồi `POST /api/import` để thêm."

API đủ để Claude tự kiểm tra trùng và chỉ thêm phần thiếu (bảng endpoint ở trên).

## Cấu trúc

```
server/  index.ts (API) · db.ts (SQLite) · scheduler.ts (FSRS) · optimize.ts (tối ưu w)
         ai.ts (sinh thẻ) · backup.ts (sao lưu) · import-core.ts · import.ts (CLI)
src/     App.tsx (Ôn tập + Quản lý + Cài đặt) · Review.tsx · Manage.tsx · Dashboard.tsx · api.ts
data/    kb.db  (gitignore — dữ liệu + tiến trình) · backups/ (bản sao tự động)
```
