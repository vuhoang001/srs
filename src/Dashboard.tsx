import { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Progress, Flex, Typography } from 'antd'
import { api, type Dashboard as D, type Maturity } from './api.ts'

// Do chin: mau + nhan cho tung nhom the
const CHIN: { key: keyof Maturity; label: string; color: string }[] = [
  { key: 'new', label: 'Mới', color: '#6b7280' },
  { key: 'learning', label: 'Đang học', color: '#e0982f' },
  { key: 'young', label: 'Non (<21 ngày)', color: '#3b82f6' },
  { key: 'mature', label: 'Chín (≥21 ngày)', color: '#2fb574' },
]

export function Dashboard() {
  const [d, setD] = useState<D | null>(null)
  useEffect(() => { api.dashboard().then(setD).catch(() => {}) }, [])
  if (!d) return <div className="done">…</div>

  const maxF = Math.max(1, ...d.forecast.map((x) => x.n))
  const maxH = Math.max(1, ...d.heatmap.map((x) => x.n))
  const dow = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

  // chia heatmap 90 ngay thanh cac tuan (cot), moi cot 7 o
  const weeks: { day: string; n: number }[][] = []
  for (let i = 0; i < d.heatmap.length; i += 7) weeks.push(d.heatmap.slice(i, i + 7))
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / maxH) * 4)))

  const chinTong = CHIN.reduce((s, c) => s + d.maturity[c.key], 0)

  return (
    <>
      <Row gutter={[14, 14]} style={{ margin: '10px 0 4px' }}>
        <Col xs={12} sm={6}><Card className="statcard"><Statistic title="Đã ôn hôm nay" value={d.daOnHomNay} /></Card></Col>
        <Col xs={12} sm={6}><Card className="statcard"><Statistic title="Chuỗi ngày" value={d.streak} suffix={d.streak ? '🔥' : ''} /></Card></Col>
        <Col xs={12} sm={6}><Card className="statcard"><Statistic title="Tỉ lệ nhớ (30 ngày)" value={d.retention === null ? '—' : d.retention} suffix={d.retention === null ? '' : '%'} /></Card></Col>
        <Col xs={12} sm={6}><Card className="statcard"><Statistic title="Lượt ôn 30 ngày" value={d.review30} /><div className="stat-s">{d.tongThe} thẻ tổng</div></Card></Col>
      </Row>

      <h3 className="h">Độ chín của thẻ</h3>
      <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', background: '#1f2531' }}>
        {CHIN.map((c) => {
          const n = d.maturity[c.key]
          if (!n) return null
          return <div key={c.key} title={`${c.label}: ${n}`} style={{ width: `${(n / chinTong) * 100}%`, background: c.color }} />
        })}
      </div>
      <Flex gap={16} wrap style={{ marginTop: 8 }}>
        {CHIN.map((c) => (
          <Typography.Text key={c.key} type="secondary" style={{ fontSize: 12 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c.color, marginRight: 5 }} />
            {c.label}: <b>{d.maturity[c.key]}</b>
          </Typography.Text>
        ))}
      </Flex>

      {d.retentionByDeck.length > 0 && (
        <>
          <h3 className="h">Tỉ lệ nhớ theo deck (30 ngày)</h3>
          <Flex vertical gap={10}>
            {d.retentionByDeck.map((x) => (
              <Flex key={x.deck} align="center" gap={12}>
                <Typography.Text style={{ width: 160, flexShrink: 0 }} ellipsis title={x.deck}>{x.deck}</Typography.Text>
                <Progress percent={x.retention} size="small" style={{ flex: 1, margin: 0 }}
                  strokeColor={x.retention >= 90 ? '#2fb574' : x.retention >= 80 ? '#e0982f' : '#e5484d'} />
                <Typography.Text type="secondary" style={{ width: 48, flexShrink: 0, textAlign: 'right' }}>{x.n} lượt</Typography.Text>
              </Flex>
            ))}
          </Flex>
        </>
      )}

      <h3 className="h">Dự báo 7 ngày tới</h3>
      <div className="forecast">
        {d.forecast.map((f, i) => {
          const dt = new Date(f.day + 'T00:00:00')
          return (
            <div key={f.day} className="fcol">
              <div className="fbar-wrap"><div className="fbar" style={{ height: `${(f.n / maxF) * 100}%` }} /></div>
              <div className="fnum">{f.n}</div>
              <div className="flabel">{i === 0 ? 'Nay' : dow[dt.getDay()]}</div>
            </div>
          )
        })}
      </div>

      <h3 className="h">Lịch ôn 90 ngày</h3>
      <div className="heat">
        {weeks.map((w, i) => (
          <div key={i} className="hcol">
            {w.map((day) => (
              <div key={day.day} className={`hcell l${level(day.n)}`} title={`${day.day}: ${day.n} lượt`} />
            ))}
          </div>
        ))}
      </div>
      <div className="legend">ít <span className="hcell l0" /><span className="hcell l1" /><span className="hcell l2" /><span className="hcell l3" /><span className="hcell l4" /> nhiều</div>
    </>
  )
}
