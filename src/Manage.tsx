import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Table, Input, Select, Button, Space, Tag, Modal, Upload, Flex, Typography, InputNumber, Alert, Spin, Tree } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, UploadOutlined, DownloadOutlined, DeleteOutlined, EditOutlined, InboxOutlined, RobotOutlined, FolderOutlined } from '@ant-design/icons'
import { api, type Card } from './api.ts'
import { Html } from './util.tsx'

const PAGE_SIZE = 50
const cleanTags = (t: string) => (t || '').replace(/kbg_\w+/g, '').trim()
// Bo HTML -> chi con chu, de hien tieu de mot dong cho gon
const plain = (h: string) => (h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

// Dung cay deck tu ten co dau '::' (KB::dbt -> KB > dbt). Dem cong don len nut cha.
type DeckNode = { key: string; title: string; count: number; children?: DeckNode[] }
function buildDeckTree(decks: { deck: string; n: number }[]): DeckNode[] {
  const roots: DeckNode[] = []
  const byPath = new Map<string, DeckNode>()
  const count = new Map<string, number>()
  for (const { deck, n } of decks) {
    const parts = deck.split('::')
    let path = ''
    let siblings = roots
    for (let i = 0; i < parts.length; i++) {
      path = i ? `${path}::${parts[i]}` : parts[i]
      count.set(path, (count.get(path) || 0) + n)
      let node = byPath.get(path)
      if (!node) { node = { key: path, title: parts[i], count: 0, children: [] }; byPath.set(path, node); siblings.push(node) }
      siblings = node.children!
    }
  }
  byPath.forEach((node, path) => { node.count = count.get(path) || 0; if (!node.children!.length) delete node.children })
  return roots
}

export function Manage({ onChange }: { onChange: () => void }) {
  const [q, setQ] = useState('')
  const [deck, setDeck] = useState('')
  const [state, setState] = useState('')
  const [decks, setDecks] = useState<{ deck: string; n: number }[]>([])
  const [data, setData] = useState<{ cards: Card[]; total: number; khop: number; page: number; soTrang: number }>(
    { cards: [], total: 0, khop: 0, page: 1, soTrang: 1 })
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<string[]>([])
  const [edit, setEdit] = useState<Card | 'new' | null>(null)
  const [imp, setImp] = useState(false)
  const [ai, setAi] = useState(false)
  const [deckMgr, setDeckMgr] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => { api.decks().then(setDecks).catch(() => {}) }, [data.total])
  useEffect(() => { setPage(1) }, [q, deck, state])
  const load = useCallback(() => {
    setLoading(true)
    return api.cards({ q, deck, state, page, pageSize: PAGE_SIZE })
      .then((d) => { setData(d); if (d.page !== page) setPage(d.page) })
      .catch(() => {}).finally(() => setLoading(false))
  }, [q, deck, state, page])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  const del = (g: string) => Modal.confirm({
    title: 'Xoá thẻ này?', content: 'Cả tiến trình ôn cũng mất.', okText: 'Xoá', okButtonProps: { danger: true }, cancelText: 'Huỷ',
    onOk: async () => { await api.remove(g); load(); onChange() },
  })
  const bulkDel = () => Modal.confirm({
    title: `Xoá ${sel.length} thẻ đã chọn?`, okText: 'Xoá', okButtonProps: { danger: true }, cancelText: 'Huỷ',
    onOk: async () => { await api.bulk(sel, 'delete'); setSel([]); load(); onChange() },
  })
  const bulkDeck = () => {
    let d = ''
    Modal.confirm({
      title: 'Chuyển các thẻ đã chọn sang deck', okText: 'Chuyển', cancelText: 'Huỷ',
      content: <Input placeholder="Tên deck…" onChange={(e) => (d = e.target.value)} />,
      onOk: async () => { if (!d.trim()) return; await api.bulk(sel, 'deck', d.trim()); setSel([]); load(); onChange() },
    })
  }

  // Mau theo do kho — de luot mat thay ngay the nao nang
  const MAU_TAG: Record<string, string> = { easy: 'green', medium: 'gold', hard: 'red' }

  const columns: ColumnsType<Card> = [
    { title: 'Mặt trước', dataIndex: 'front', ellipsis: true, render: (_, c) => plain(c.front) },
    { title: 'Deck', dataIndex: 'deck', width: 180, ellipsis: true,
      render: (d: string) => <Typography.Text type="secondary">{d}</Typography.Text> },
    {
      title: 'Tags', dataIndex: 'tags', width: 260, ellipsis: true,
      render: (t: string) => (
        <Space size={4} wrap>
          {(t || '').split(/\s+/).filter(Boolean).map((x) => (
            <Tag key={x} color={MAU_TAG[x]} style={{ marginInlineEnd: 0 }}>{x}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Tiến trình', key: 'tt', width: 150,
      render: (_, c) =>
        !c.reps
          ? <Typography.Text type="secondary">Chưa học</Typography.Text>
          : <Typography.Text type="secondary">
              {c.reps} lượt{c.due ? ` · ${new Date(c.due).toLocaleDateString('vi')}` : ''}
            </Typography.Text>,
    },
    {
      title: '', key: 'act', width: 78,
      render: (_, c) => (
        <Space size={0}>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEdit(c)} />
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => del(c.guid)} />
        </Space>
      ),
    },
  ]

  // Chieu cao khung -> danh sach co dinh theo man hinh, cuon rieng ben trong
  const [vh, setVh] = useState(typeof window !== 'undefined' ? window.innerHeight : 800)
  useEffect(() => {
    const f = () => setVh(window.innerHeight)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const treeData = useMemo(
    () => [{ key: '', title: 'Tất cả', count: decks.reduce((s, d) => s + d.n, 0), children: buildDeckTree(decks) }],
    [decks])

  return (
    <>
      <Flex gap={12} align="stretch" style={{ marginTop: 10, height: 'calc(100vh - 140px)' }}>
        {/* Sidebar: cay deck — bam vao -> hien the ben trong */}
        <div style={{ width: 268, flexShrink: 0, overflow: 'auto', paddingRight: 6, borderRight: '1px solid var(--line)' }}>
          <Tree
            treeData={treeData as any}
            selectedKeys={[deck]}
            defaultExpandAll
            blockNode
            titleRender={(node: any) => (
              <span>{node.title}<Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{node.count}</Typography.Text></span>
            )}
            onSelect={(keys) => { if (keys.length) setDeck(String(keys[0])) }}
          />
        </div>

        {/* Cot phai: tim + trang thai + nut + bang */}
        <Flex vertical gap={10} style={{ flex: 1, minWidth: 0 }}>
          <Flex gap={9} wrap align="center">
            <Input.Search allowClear placeholder="Tìm mặt trước / tags…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 170 }} />
            <Select value={state} onChange={setState} style={{ width: 150 }}
              options={[
                { value: '', label: 'Mọi trạng thái' },
                { value: 'new', label: 'Chưa học' },
                { value: 'due', label: 'Đến hạn' },
                { value: 'seen', label: 'Đã học' },
              ]} />
            <Space wrap>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEdit('new')}>Thẻ</Button>
              <Button icon={<RobotOutlined />} onClick={() => setAi(true)}>AI</Button>
              <Button icon={<FolderOutlined />} onClick={() => setDeckMgr(true)}>Deck</Button>
              <Button icon={<UploadOutlined />} onClick={() => setImp(true)}>Import</Button>
              <Button icon={<DownloadOutlined />} href="/api/export?format=json">Xuất</Button>
            </Space>
          </Flex>

          {sel.length > 0 && (
            <Flex align="center" gap={10} className="bulkbar">
              <b style={{ marginRight: 'auto' }}>{sel.length} đã chọn</b>
              <Button size="small" onClick={bulkDeck}>Đổi deck</Button>
              <Button size="small" danger onClick={bulkDel}>Xoá</Button>
              <Button size="small" type="text" onClick={() => setSel([])}>Bỏ chọn</Button>
            </Flex>
          )}

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {data.khop} thẻ{deck ? <> trong <b>{deck}</b></> : ''}
          </Typography.Text>

          <div style={{ flex: 1, minHeight: 0 }}>
            <Table<Card>
              rowKey="guid"
              size="small"
              loading={loading}
              columns={columns}
              dataSource={data.cards}
              rowSelection={{ selectedRowKeys: sel, preserveSelectedRowKeys: true, onChange: (keys) => setSel(keys as string[]) }}
              scroll={{ y: Math.max(220, vh - 320) }}
              pagination={{
                current: data.page, pageSize: PAGE_SIZE, total: data.khop,
                showSizeChanger: false, showLessItems: true, size: 'small',
                onChange: setPage,
              }}
            />
          </div>
        </Flex>
      </Flex>

      {edit && <Editor card={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); onChange() }} />}
      {imp && <Import onClose={() => setImp(false)} onDone={() => { setImp(false); load(); onChange() }} />}
      {ai && <AiGen onClose={() => setAi(false)} onDone={() => { setAi(false); load(); onChange() }} />}
      {deckMgr && <DeckManager onClose={() => setDeckMgr(false)} onChanged={() => { load(); onChange() }} />}
    </>
  )
}

// Quan ly tung deck: xem so the, xuat rieng, doi ten, xoa ca deck.
function DeckManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [decks, setDecks] = useState<{ deck: string; n: number }[]>([])
  const load = () => api.decks().then(setDecks).catch(() => {})
  useEffect(() => { load() }, [])

  const rename = (from: string) => {
    let to = from
    Modal.confirm({
      title: 'Đổi tên deck', okText: 'Đổi', cancelText: 'Huỷ',
      content: <Input defaultValue={from} onChange={(e) => (to = e.target.value)} />,
      onOk: async () => {
        if (!to.trim() || to === from) return
        const r = await api.renameDeck(from, to.trim())
        load(); onChanged()
        Modal.success({ title: 'Đã đổi tên', content: `${r.so} thẻ chuyển sang "${to.trim()}".` })
      },
    })
  }
  const del = (deck: string, n: number) => Modal.confirm({
    title: `Xoá deck "${deck}"?`, okText: 'Xoá', okButtonProps: { danger: true }, cancelText: 'Huỷ',
    content: `Xoá toàn bộ ${n} thẻ và tiến trình ôn của deck này. Không hoàn tác được (nên Xuất trước).`,
    onOk: async () => { await api.deleteDeck(deck); load(); onChanged() },
  })

  const columns: ColumnsType<{ deck: string; n: number }> = [
    { title: 'Deck', dataIndex: 'deck', render: (d) => <b>{d}</b> },
    { title: 'Thẻ', dataIndex: 'n', width: 70 },
    {
      title: 'Thao tác', key: 'act', width: 260,
      render: (_, d) => {
        const qs = `deck=${encodeURIComponent(d.deck)}`
        return (
          <Space size={4} wrap>
            <Button size="small" icon={<DownloadOutlined />} href={`/api/export?format=csv&${qs}`}>CSV</Button>
            <Button size="small" icon={<DownloadOutlined />} href={`/api/export?format=json&${qs}`}>JSON</Button>
            <Button size="small" icon={<EditOutlined />} onClick={() => rename(d.deck)}>Đổi tên</Button>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => del(d.deck, d.n)} />
          </Space>
        )
      },
    },
  ]

  return (
    <Modal open title="Quản lý deck" onCancel={onClose} footer={<Button onClick={onClose}>Đóng</Button>} width={680} destroyOnClose>
      <Typography.Paragraph type="secondary">
        Mỗi deck là một nhóm chủ đề (vd <b>KB::dbt</b>, <b>KB::Data Modeling</b>). Xuất riêng để chia sẻ/sao lưu từng nhóm;
        đổi tên gộp thẻ về cùng deck; xoá cả deck khi không cần.
      </Typography.Paragraph>
      <Table<{ deck: string; n: number }> rowKey="deck" size="small" columns={columns} dataSource={decks} pagination={false} />
    </Modal>
  )
}

// Dan mot doan tai lieu -> Claude sinh bo the front/back de duyet roi import.
function AiGen({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; models: string[] } | null>(null)
  const [text, setText] = useState('')
  const [deck, setDeck] = useState('Nhap')
  const [model, setModel] = useState('claude-opus-4-8')
  const [count, setCount] = useState(15)
  const [cards, setCards] = useState<{ front: string; back: string; tags: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [kq, setKq] = useState<string | null>(null)

  useEffect(() => { api.aiStatus().then((s) => { setStatus(s); if (s.models[0]) setModel(s.models[0]) }).catch(() => setStatus({ enabled: false, models: [] })) }, [])

  const gen = async () => {
    setBusy(true); setErr(''); setCards(null)
    try { setCards((await api.generate(text, model, count, deck)).cards) }
    catch (e: any) { setErr(e?.message || 'Tạo thẻ thất bại') }
    finally { setBusy(false) }
  }
  const doImport = async () => {
    if (!cards?.length) return
    const r = await api.import(cards, deck)
    setKq(`+${r.them} thẻ mới, ${r.sua} cập nhật, ${r.giu} không đổi.`)
  }

  return (
    <Modal open title="AI tạo thẻ từ tài liệu" onCancel={kq ? onDone : onClose} width={620} destroyOnClose
      footer={[
        <Button key="c" onClick={kq ? onDone : onClose}>{kq ? 'Xong' : 'Huỷ'}</Button>,
        !kq && !cards && <Button key="g" type="primary" loading={busy} disabled={!status?.enabled || text.trim().length < 10} onClick={gen}>Tạo thẻ</Button>,
        !kq && cards && <Button key="i" type="primary" onClick={doImport}>Import {cards.length} thẻ</Button>,
      ]}>
      {status && !status.enabled && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="Chưa bật AI"
          description="Đặt biến môi trường ANTHROPIC_API_KEY rồi khởi động lại server để dùng tính năng này." />
      )}
      {!cards ? (
        <>
          <label>Dán nội dung / ghi chú / tài liệu</label>
          <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 6, maxRows: 16 }}
            placeholder="Dán đoạn văn bản cần biến thành thẻ học…" />
          <Flex gap={10} wrap style={{ marginTop: 10 }}>
            <div style={{ flex: 1, minWidth: 160 }}><label>Model</label>
              <Select value={model} onChange={setModel} style={{ width: '100%' }}
                options={(status?.models || ['claude-opus-4-8']).map((m) => ({ value: m, label: m }))} /></div>
            <div style={{ width: 120 }}><label>Số thẻ tối đa</label>
              <InputNumber min={1} max={50} value={count} onChange={(v) => setCount(v ?? 15)} style={{ width: '100%' }} /></div>
            <div style={{ flex: 1, minWidth: 140 }}><label>Deck</label>
              <Input value={deck} onChange={(e) => setDeck(e.target.value)} /></div>
          </Flex>
          {busy && <Flex justify="center" style={{ marginTop: 16 }}><Spin tip="Đang tạo thẻ…"><div style={{ padding: 20 }} /></Spin></Flex>}
          {err && <Typography.Text type="danger" style={{ display: 'block', marginTop: 10 }}>{err}</Typography.Text>}
        </>
      ) : (
        <>
          <Typography.Text type="secondary">Xem trước {cards.length} thẻ — bấm Import để thêm vào deck <b>{deck}</b>.</Typography.Text>
          <div style={{ maxHeight: 340, overflow: 'auto', marginTop: 8 }}>
            {cards.map((c, i) => (
              <div key={i} style={{ borderTop: '1px solid #2a2f3a', padding: '8px 0' }}>
                <div><b>{c.front}</b></div>
                <Typography.Text type="secondary">{c.back}</Typography.Text>
              </div>
            ))}
          </div>
          {kq && <Alert type="success" showIcon style={{ marginTop: 10 }} message={kq} />}
        </>
      )}
    </Modal>
  )
}

// Soan thao WYSIWYG nhe (contentEditable): boi den chu roi bam B/I/code -> in dam/nghieng NGAY
// tai cho, khong hien the HTML. Luu ra chuoi HTML (b/i/code) khop voi bo render cua the.
// antd khong co san rich editor nen tu lam, khong them thu vien.
function RichText({ value, onChange, placeholder, autoFocus, minHeight = 84 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Nap noi dung ban dau MOT lan (Editor mount moi moi lan mo) — khong ghi de khi dang go
  // de con tro khong bi nhay. eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value || ''
    if (autoFocus) ref.current?.focus()
  }, [])
  const emit = () => onChange(ref.current?.innerHTML || '')
  const exec = (cmd: string) => {
    ref.current?.focus()
    try { document.execCommand('styleWithCSS', false, 'false') } catch { /* bo qua */ }
    document.execCommand(cmd)
    emit()
  }
  const wrapCode = () => {
    ref.current?.focus()
    const sel = window.getSelection()
    const text = sel && sel.rangeCount ? sel.toString() : ''
    document.execCommand('insertHTML', false, `<code>${text || 'code'}</code>`)
    emit()
  }
  // Giu selection khi bam nut (onMouseDown preventDefault) -> dinh dang dung phan boi den
  const keep = (e: any) => e.preventDefault()
  return (
    <>
      <Space.Compact size="small" style={{ marginBottom: 6 }}>
        <Button onMouseDown={keep} onClick={() => exec('bold')} title="Đậm (Ctrl+B)"><b>B</b></Button>
        <Button onMouseDown={keep} onClick={() => exec('italic')} title="Nghiêng (Ctrl+I)"><i>I</i></Button>
        <Button onMouseDown={keep} onClick={wrapCode} title="Mã"><span style={{ fontFamily: 'monospace' }}>&lt;/&gt;</span></Button>
      </Space.Compact>
      <div ref={ref} className="rt-edit" contentEditable suppressContentEditableWarning
        data-ph={placeholder} style={{ minHeight }} onInput={emit} />
    </>
  )
}

export function Editor({ card, onClose, onSaved }: { card: Card | 'new'; onClose: () => void; onSaved: () => void }) {
  const isNew = card === 'new'
  const c = isNew ? null : (card as Card)
  const [front, setFront] = useState(c?.front || '')
  const [back, setBack] = useState(c?.back || '')
  const [tags, setTags] = useState(cleanTags(c?.tags || ''))
  const [deck, setDeck] = useState(c?.deck || 'Nhap')
  const [dup, setDup] = useState<string[]>([])

  useEffect(() => {
    if (!front.trim()) { setDup([]); return }
    const t = setTimeout(() => api.checkDup(front, c?.guid).then((r) => setDup(r.trung)).catch(() => {}), 350)
    return () => clearTimeout(t)
  }, [front, c?.guid])

  const save = async () => {
    if (!front.trim() || !back.trim()) return Modal.warning({ title: 'Thiếu nội dung', content: 'Cần cả mặt trước và mặt sau.' })
    if (isNew) await api.create({ front, back, tags, deck })
    else await api.update(c!.guid, { front, back, tags, deck })
    onSaved()
  }
  return (
    <Modal open title={isNew ? 'Thẻ mới' : 'Sửa thẻ'} onCancel={onClose} onOk={save} okText="Lưu" cancelText="Huỷ" width={560} destroyOnClose>
      <Typography.Paragraph type="secondary">
        {!isNew && <>Sửa mặt trước/sau vẫn <b>giữ nguyên tiến trình ôn</b>. </>}
        Bôi đen chữ rồi bấm <b>B</b>/<i>I</i>/<span style={{ fontFamily: 'monospace' }}>&lt;/&gt;</span> (hoặc Ctrl+B) để định dạng — không cần gõ thẻ HTML.
      </Typography.Paragraph>
      <label>Mặt trước</label>
      <RichText value={front} onChange={setFront} autoFocus={isNew} placeholder="Câu hỏi…" />
      {dup.length > 0 && <Typography.Text type="warning" style={{ display: 'block', marginTop: 6 }}>⚠ {dup.length} thẻ khác trùng mặt trước — có thể câu này đã tồn tại.</Typography.Text>}
      <label>Mặt sau</label>
      <RichText value={back} onChange={setBack} placeholder="Đáp án…" />
      <Flex gap={10}>
        <div style={{ flex: 1 }}><label>Deck</label><Input value={deck} onChange={(e) => setDeck(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label>Tags</label><Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      </Flex>
    </Modal>
  )
}

function Import({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Partial<Card>[]>([])
  const [deck, setDeck] = useState('Nhap')
  const [kq, setKq] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const onFile = async (file: File) => {
    setErr('')
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const pick = (o: Record<string, any>, keys: string[]) => {
        const k = Object.keys(o).find((x) => keys.includes(x.trim().toLowerCase()))
        return k ? String(o[k]).trim() : ''
      }
      const parsed = json.map((o) => ({
        front: pick(o, ['front', 'mặt trước', 'mat truoc', 'question', 'câu hỏi', 'cau hoi', 'q']),
        back: pick(o, ['back', 'mặt sau', 'mat sau', 'answer', 'đáp án', 'dap an', 'a']),
        tags: pick(o, ['tags', 'tag', 'nhãn', 'nhan']),
        deck: pick(o, ['deck', 'bộ', 'bo', 'chủ đề', 'chu de']),
        id: pick(o, ['id', 'guid']),
      })).filter((r) => r.front && r.back)
      if (!parsed.length) setErr('Không thấy cột front/back. Header cần "front" và "back" (hoặc "câu hỏi"/"đáp án").')
      setRows(parsed)
    } catch (e: any) { setErr('Đọc file lỗi: ' + e.message) }
  }
  const doImport = async () => {
    const r = await api.import(rows, deck)
    setKq(`+${r.them} thẻ mới, ${r.sua} cập nhật, ${r.giu} không đổi.` +
      (r.trung.length ? ` ⚠ ${r.trung.length} thẻ trùng mặt trước với thẻ có sẵn.` : ''))
  }
  // File mau .xlsx: dung header + vai dong vi du de nguoi dung hieu cach dien
  const downloadTemplate = () => {
    const sample = [
      { front: 'Grain của một bảng là gì?', back: 'Mức chi tiết mà mỗi dòng đại diện', tags: 'grain', deck: 'KB::Data Modeling', id: '' },
      { front: 'dbt model là gì?', back: 'File SQL SELECT được dbt biến thành bảng/view', tags: 'dbt', deck: 'KB::dbt', id: '' },
      { front: '{{c1::Star schema}} đặt bảng fact ở trung tâm', back: '(thẻ cloze — có thể để trống mặt sau)', tags: 'modeling', deck: 'KB::Data Modeling', id: '' },
    ]
    const ws = XLSX.utils.json_to_sheet(sample, { header: ['front', 'back', 'tags', 'deck', 'id'] })
    ws['!cols'] = [{ wch: 40 }, { wch: 40 }, { wch: 14 }, { wch: 20 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'the')
    XLSX.writeFile(wb, 'srs-mau.xlsx')
  }
  return (
    <Modal open title="Import từ Excel / CSV / TSV" onCancel={kq ? onDone : onClose} width={560} destroyOnClose
      footer={[
        <Button key="c" onClick={kq ? onDone : onClose}>{kq ? 'Xong' : 'Huỷ'}</Button>,
        !kq && <Button key="i" type="primary" disabled={!rows.length} onClick={doImport}>Import {rows.length || ''}</Button>,
      ]}>
      <Flex align="center" justify="space-between" gap={8} wrap style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ flex: 1, minWidth: 220 }}>
          Cần cột <b>front</b> và <b>back</b> (chấp nhận "câu hỏi"/"đáp án"). Tuỳ chọn: <b>tags</b>, <b>deck</b>, <b>id</b>.
          Có cột <b>id</b> thì re-import vẫn giữ tiến trình.
        </Typography.Text>
        <Button size="small" icon={<DownloadOutlined />} onClick={downloadTemplate}>Tải file mẫu</Button>
      </Flex>
      <Upload.Dragger accept=".xlsx,.xls,.csv,.tsv,.txt" maxCount={1} showUploadList={false}
        beforeUpload={(file) => { onFile(file as unknown as File); return false }}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">Kéo thả hoặc bấm chọn file</p>
      </Upload.Dragger>
      {err && <Typography.Text type="danger" style={{ display: 'block', marginTop: 8 }}>{err}</Typography.Text>}
      {rows.length > 0 && (<>
        <label>Deck mặc định (cho hàng không có cột deck)</label>
        <Input value={deck} onChange={(e) => setDeck(e.target.value)} />
        <Typography.Text type="success" style={{ display: 'block', marginTop: 8 }}>Đọc được {rows.length} thẻ.</Typography.Text>
      </>)}
      {kq && <Typography.Text type="success" style={{ display: 'block', marginTop: 8 }}>{kq}</Typography.Text>}
    </Modal>
  )
}
