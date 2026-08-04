import { useEffect, useState, useCallback } from 'react'
import { Segmented, Button, Modal, InputNumber, Typography, Flex, Divider, Alert, Slider } from 'antd'
import { SettingOutlined, ThunderboltOutlined, SaveOutlined } from '@ant-design/icons'
import { api, type OptimizeResult } from './api.ts'
import { Review } from './Review.tsx'
import { Manage } from './Manage.tsx'
import { Dashboard } from './Dashboard.tsx'

type View = 'review' | 'stats' | 'manage'
const LABELS: Record<View, string> = { review: 'Ôn tập', stats: 'Thống kê', manage: 'Quản lý' }

export function App() {
  const [view, setView] = useState<View>('review')
  const [stats, setStats] = useState({ total: 0, daOnHomNay: 0 })
  const [cfg, setCfg] = useState(false)
  const refresh = useCallback(() => api.stats().then(setStats).catch(() => {}), [])
  useEffect(() => { refresh() }, [refresh, view])

  // Tab doc mot the -> cot hep de de doc. Tab bang/bieu do -> dung het be ngang.
  return (
    <div className={view === 'review' ? 'wrap' : 'wrap wide'}>
      <header>
        <h1>🧠 SRS</h1>
        <Typography.Text type="secondary" className="pill">đã ôn <b>{stats.daOnHomNay}</b> · <b>{stats.total}</b> thẻ</Typography.Text>
        <Flex gap={8} align="center" style={{ marginLeft: 'auto' }}>
          <Segmented<View>
            value={view}
            onChange={setView}
            options={(['review', 'stats', 'manage'] as View[]).map((v) => ({ value: v, label: LABELS[v] }))}
          />
          <Button type="text" icon={<SettingOutlined />} title="Cài đặt" onClick={() => setCfg(true)} />
        </Flex>
      </header>

      {view === 'review' && <Review onChange={refresh} />}
      {view === 'stats' && <Dashboard />}
      {view === 'manage' && <Manage onChange={refresh} />}

      {cfg && <Settings onClose={() => setCfg(false)} />}
    </div>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const [npd, setNpd] = useState(20)
  const [maxRev, setMaxRev] = useState(200)
  const [rr, setRr] = useState(90)          // % — mac trong luu la 0.90
  const [learnAhead, setLearnAhead] = useState(20)
  const [hasW, setHasW] = useState(false)   // dang dung tham so toi uu rieng?
  const [opt, setOpt] = useState<OptimizeResult | null>(null)
  const [running, setRunning] = useState(false)
  const [resched, setResched] = useState(false)
  const [reschedN, setReschedN] = useState<number | null>(null)
  const [backups, setBackups] = useState<{ file: string; at: string }[]>([])
  const [backing, setBacking] = useState(false)

  const loadCfg = () => api.settings().then((s) => {
    setNpd(Number(s.new_per_day) || 0)
    setMaxRev(Number(s.max_reviews_per_day) || 0)
    setRr(Math.round((Number(s.request_retention) || 0.9) * 100))
    setLearnAhead(Number(s.learn_ahead_min) || 0)
    setHasW(!!s.w)
  }).catch(() => {})
  const loadBackups = () => api.backups().then(setBackups).catch(() => {})
  useEffect(() => { loadCfg(); loadBackups() }, [])

  const reschedule = async () => {
    setResched(true); setReschedN(null)
    try { setReschedN((await api.reschedule()).so) } finally { setResched(false) }
  }
  const doBackup = async () => {
    setBacking(true)
    try { await api.backup(); await loadBackups() } finally { setBacking(false) }
  }

  const save = async () => {
    await api.saveSettings({
      new_per_day: String(npd),
      max_reviews_per_day: String(maxRev),
      request_retention: String(rr / 100),
      learn_ahead_min: String(learnAhead),
    })
    onClose()
  }

  const optimize = async () => {
    setRunning(true); setOpt(null)
    try { setOpt(await api.optimize()); await loadCfg() }
    catch (e: any) { setOpt({ ok: false, reviews: 0, cards: 0, message: e?.message || 'Tối ưu thất bại' }) }
    finally { setRunning(false) }
  }
  const resetW = async () => { await api.optimizeReset(); setOpt(null); await loadCfg() }

  return (
    <Modal open title="Cài đặt" onCancel={onClose} onOk={save} okText="Lưu" cancelText="Huỷ" destroyOnClose width={560}>
      <label>Số thẻ mới mỗi ngày</label>
      <InputNumber min={0} value={npd} onChange={(v) => setNpd(v ?? 0)} style={{ width: '100%' }} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
        Giới hạn số thẻ chưa học đưa ra ôn mỗi ngày — tránh học dồn quá tải.
      </Typography.Paragraph>

      <label>Số lượt ôn (thẻ cũ) tối đa mỗi ngày</label>
      <InputNumber min={0} value={maxRev} onChange={(v) => setMaxRev(v ?? 0)} style={{ width: '100%' }} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>0 = không giới hạn. Thẻ đang học lại trong buổi luôn được hiện.</Typography.Paragraph>

      <label>Mục tiêu tỉ lệ nhớ: <b>{rr}%</b></label>
      <Slider min={80} max={97} value={rr} onChange={setRr} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Cao hơn = nhớ chắc hơn nhưng ôn nhiều hơn. FSRS khuyến nghị ~90%.
      </Typography.Paragraph>

      <label>Cửa sổ học lại trong buổi (phút)</label>
      <InputNumber min={0} value={learnAhead} onChange={(v) => setLearnAhead(v ?? 0)} style={{ width: '100%' }} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
        Thẻ bấm Again sẽ hiện lại trong buổi nếu đến hạn trong khoảng này.
      </Typography.Paragraph>

      <Divider style={{ margin: '8px 0 14px' }} />
      <Flex align="center" justify="space-between" wrap gap={8}>
        <span>
          <b>Tối ưu tham số FSRS</b>{' '}
          <Typography.Text type={hasW ? 'success' : 'secondary'}>
            {hasW ? '· đang dùng tham số riêng' : '· đang dùng mặc định'}
          </Typography.Text>
        </span>
        <Flex gap={8}>
          {hasW && <Button size="small" onClick={resetW}>Về mặc định</Button>}
          <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={running} onClick={optimize}>Tối ưu</Button>
        </Flex>
      </Flex>
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
        Học 19 tham số riêng từ lịch sử ôn của bạn để lịch chính xác hơn (cần đủ dữ liệu).
      </Typography.Paragraph>
      {opt && (
        <Alert
          type={opt.ok ? 'success' : 'info'}
          showIcon
          message={opt.ok
            ? `Đã tối ưu từ ${opt.reviews} lượt / ${opt.cards} thẻ` +
              (opt.lossBefore != null && opt.lossAfter != null
                ? ` · log-loss ${opt.lossBefore.toFixed(3)} → ${opt.lossAfter.toFixed(3)}` : '')
            : opt.message}
        />
      )}

      <Flex align="center" justify="space-between" wrap gap={8} style={{ marginTop: 12 }}>
        <span><b>Tính lại lịch</b></span>
        <Button size="small" loading={resched} onClick={reschedule}>Tính lại</Button>
      </Flex>
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
        Áp tham số hiện tại (retention/tối ưu) cho lịch các thẻ đã học — không đổi lịch sử ôn.
      </Typography.Paragraph>
      {reschedN != null && <Alert type="success" showIcon message={`Đã tính lại lịch cho ${reschedN} thẻ.`} />}

      <Divider style={{ margin: '8px 0 14px' }} />
      <Flex align="center" justify="space-between" wrap gap={8}>
        <span><b>Sao lưu dữ liệu</b></span>
        <Button size="small" type="primary" icon={<SaveOutlined />} loading={backing} onClick={doBackup}>Sao lưu ngay</Button>
      </Flex>
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
        Sao lưu khi bạn bấm. Toàn bộ thẻ + tiến trình học lưu trong một file — tải về để giữ an toàn.
      </Typography.Paragraph>
      {backups.length > 0 && (
        <Flex vertical gap={4}>
          {backups.slice(0, 5).map((b) => (
            <Flex key={b.file} justify="space-between" align="center">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{new Date(b.at).toLocaleString('vi')}</Typography.Text>
              <a href={`/api/backups/${b.file}`}>Tải về</a>
            </Flex>
          ))}
        </Flex>
      )}
    </Modal>
  )
}
