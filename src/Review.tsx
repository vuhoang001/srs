import { useEffect, useState, useCallback, useRef } from 'react'
import { Select, Segmented, Progress, Button, Flex, Typography, Input, Tag } from 'antd'
import { UndoOutlined, EditOutlined, SoundOutlined } from '@ant-design/icons'
import { api, type NextResp, type Card } from './api.ts'
import { Html, fmtInterval, speak } from './util.tsx'
import { Editor } from './Manage.tsx'

type Mode = 'flash' | 'quiz' | 'type'
type Dir = 'fwd' | 'rev' | 'both'

const RATINGS = [
  { n: 1, label: 'Again', color: 'red' as const },
  { n: 2, label: 'Hard', color: 'orange' as const },
  { n: 3, label: 'Good', color: 'green' as const },
  { n: 4, label: 'Easy', color: 'blue' as const },
]

// So khop dap an go tay: bo HTML, gom khoang trang, bo hoa/thuong
const norm = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

export function Review({ onChange }: { onChange: () => void }) {
  const [r, setR] = useState<NextResp | null>(null)
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deck, setDeck] = useState('')
  const [tag, setTag] = useState('')
  const [mode, setMode] = useState<Mode>('flash')
  const [dir, setDir] = useState<Dir>('fwd')
  const [decks, setDecks] = useState<{ deck: string; n: number }[]>([])
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  const [editing, setEditing] = useState<Card | null>(null)
  // go dap an
  const [typed, setTyped] = useState('')
  const [matched, setMatched] = useState<boolean | null>(null)
  const inputRef = useRef<any>(null)

  useEffect(() => { api.decks().then(setDecks).catch(() => {}); api.tags().then(setTags).catch(() => {}) }, [])

  const load = useCallback(async () => {
    setLoading(true); setShow(false); setChosen(null); setTyped(''); setMatched(null)
    const data = await api.next({ deck, tag, mode, dir })
    setR(data); setLoading(false); onChange()
  }, [deck, tag, mode, dir, onChange])
  useEffect(() => { load() }, [load])

  const rate = useCallback(async (n: number) => {
    if (!r?.card) return
    await api.review(r.card.guid, n)
    setCanUndo(true)
    load()
  }, [r, load])

  const undo = useCallback(async () => {
    const res = await api.undo()
    setCanUndo(false)
    if (res.ok) load()
  }, [load])

  // go dap an: xac nhan -> so khop roi hien mat sau + cac nut cham
  const submitTyped = useCallback(() => {
    if (!r?.card || show) return
    setMatched(norm(typed) !== '' && norm(typed) === norm(r.card.back))
    setShow(true)
    inputRef.current?.blur?.()
  }, [r, show, typed])

  const nextAfterQuiz = () => {
    if (chosen === null || !r?.choices) return
    rate(r.choices[chosen].correct ? 3 : 1)
  }

  // The dang chinh sua phai la the THAT (khi hoc nguoc, front/back da bi dao)
  const realCard = (): Card | null => {
    if (!r?.card) return null
    return r.reversed ? { ...r.card, front: r.card.back, back: r.card.front } : r.card
  }

  const rRef = useRef(r); rRef.current = r
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const cur = rRef.current
      if (!cur?.card || editing) return
      const inField = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (mode === 'type') {
        if (!show && inField && e.key === 'Enter') { e.preventDefault(); submitTyped() }
        else if (show && !inField && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key))
        else if (show && !inField && e.key.toLowerCase() === 'u' && canUndo) undo()
        return
      }
      if (inField) return
      if (mode === 'quiz') {
        if (chosen !== null && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); nextAfterQuiz() }
        else if (chosen === null && ['1', '2', '3', '4'].includes(e.key) && cur.choices) {
          const i = Number(e.key) - 1
          if (cur.choices[i]) setChosen(i)
        }
        return
      }
      if (!show && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setShow(true) }
      else if (show && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key))
      else if (e.key.toLowerCase() === 'u' && canUndo) undo()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, mode, chosen, canUndo, editing, submitTyped])

  const filters = (
    <Flex gap={9} wrap style={{ margin: '10px 0' }}>
      <Select value={deck} onChange={setDeck} style={{ flex: 1, minWidth: 150 }}
        options={[{ value: '', label: 'Tất cả deck' }, ...decks.map((d) => ({ value: d.deck, label: `${d.deck} (${d.n})` }))]} />
      <Select value={tag} onChange={setTag} style={{ flex: 1, minWidth: 150 }}
        options={[{ value: '', label: 'Mọi tag' }, ...tags.slice(0, 40).map((t) => ({ value: t.tag, label: `${t.tag} (${t.n})` }))]} />
      <Segmented value={mode} onChange={(v) => setMode(v as Mode)}
        options={[{ value: 'flash', label: 'Thẻ' }, { value: 'quiz', label: 'Trắc nghiệm' }, { value: 'type', label: 'Gõ' }]} />
      <Segmented value={dir} onChange={(v) => setDir(v as Dir)}
        options={[{ value: 'fwd', label: 'Xuôi' }, { value: 'rev', label: 'Ngược' }, { value: 'both', label: 'Cả hai' }]} />
    </Flex>
  )

  if (loading) return <>{filters}<div className="done">…</div></>
  if (!r?.card) return <>{filters}<div className="done">🎉 Hết thẻ đến hạn{deck || tag ? ' (theo bộ lọc)' : ''}. Quay lại sau nhé.</div></>

  const prog = r.daOnHomNay + r.due > 0 ? (r.daOnHomNay / (r.daOnHomNay + r.due)) * 100 : 0
  // quiz khong co lua chon (vd khi hoc nguoc) -> lui ve dang the
  const effMode: Mode = mode === 'quiz' && !r.choices ? 'flash' : mode

  const rateRow = (
    <Flex gap={11} style={{ marginTop: 18 }}>
      {RATINGS.map(({ n, label, color }) => (
        <Button key={n} block size="large" color={color} variant="solid" style={{ height: 56 }} onClick={() => rate(n)}>
          <Flex vertical align="center" gap={0}>
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 11, opacity: .85 }}>{r.preview ? fmtInterval(r.preview[String(n) as '1']) : n}</span>
          </Flex>
        </Button>
      ))}
    </Flex>
  )

  return (
    <>
      {filters}
      <Progress percent={prog} showInfo={false} strokeColor={{ from: '#2fb574', to: '#4fd39a' }} trailColor="#1f2531" />
      <Flex justify="space-between" align="center" wrap gap={8} style={{ margin: '10px 0' }}>
        <Typography.Text type="secondary">đã ôn <b>{r.daOnHomNay}</b> · còn <b>{r.due}</b></Typography.Text>
        <Flex gap={4}>
          <Button size="small" type="text" icon={<SoundOutlined />} title="Đọc to"
            onClick={() => r.card && speak((show || chosen !== null) ? r.card.back : r.card.front)} />
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { const c = realCard(); if (c) setEditing(c) }}>Sửa</Button>
          {canUndo && <Button size="small" type="text" icon={<UndoOutlined />} onClick={undo}>Hoàn tác (U)</Button>}
        </Flex>
      </Flex>

      <div className="card" key={r.card.guid}>
        <div className="deck">
          {r.card.deck}
          {r.laMoi && <span className="badge-new">MỚI</span>}
          {r.reversed && <Tag color="purple" style={{ marginLeft: 8 }}>↔ NGƯỢC</Tag>}
        </div>
        <Html html={r.card.front} />
        {(effMode === 'flash' || effMode === 'type') && show && <><hr className="rev" /><Html html={r.card.back} /></>}
        {effMode === 'quiz' && chosen !== null && (<><hr className="rev" /><Html html={r.card.back} /></>)}
      </div>

      {effMode === 'flash' && (
        !show
          ? <Button type="primary" block size="large" style={{ marginTop: 18, height: 48 }} onClick={() => setShow(true)}>Hiện đáp án (Space)</Button>
          : rateRow
      )}

      {effMode === 'type' && (
        !show ? (
          <Flex gap={9} style={{ marginTop: 18 }}>
            <Input ref={inputRef} autoFocus size="large" placeholder="Gõ đáp án rồi Enter…"
              value={typed} onChange={(e) => setTyped(e.target.value)} onPressEnter={submitTyped} />
            <Button type="primary" size="large" onClick={submitTyped}>Kiểm tra</Button>
          </Flex>
        ) : (
          <>
            <Typography.Text type={matched ? 'success' : 'warning'} style={{ display: 'block', margin: '14px 0 2px' }}>
              {matched ? '✓ Khớp đáp án' : '✗ Chưa khớp'}{typed ? ` — bạn gõ: “${typed}”` : ''}
            </Typography.Text>
            {rateRow}
          </>
        )
      )}

      {effMode === 'quiz' && (
        <div className="choices">
          {r.choices?.map((c, i) => {
            let cls = 'choice'
            if (chosen !== null) cls += c.correct ? ' correct' : i === chosen ? ' wrong' : ' dim'
            return (
              <button key={i} className={cls} disabled={chosen !== null} onClick={() => chosen === null && setChosen(i)}>
                <span className="num">{i + 1}</span><Html html={c.text} />
              </button>
            )
          })}
          {chosen !== null && (
            <Button type="primary" block size="large" style={{ marginTop: 8, height: 48 }} onClick={nextAfterQuiz}>
              {r.choices?.[chosen].correct ? '✓ Đúng' : '✗ Sai'} — Tiếp (Space)
            </Button>
          )}
        </div>
      )}

      {editing && (
        <Editor card={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </>
  )
}
