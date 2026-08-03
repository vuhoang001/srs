import { useEffect, useRef } from 'react'
import hljs from 'highlight.js/lib/core'
import sql from 'highlight.js/lib/languages/sql'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'

// Chi nap ngon ngu the thuc su dung -> bundle nhe hon nhieu so voi ban day du
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('python', python)

// Khoang cach tu bay gio toi 'iso', dang ngan gon tieng Viet
export function fmtInterval(iso: string, from = Date.now()): string {
  const ms = new Date(iso).getTime() - from
  const min = Math.round(ms / 60000)
  if (min < 1) return '<1ph'
  if (min < 60) return `${min}ph`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}g`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}ng`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}th`
  return `${Math.round((mo / 12) * 10) / 10}năm`
}

// Doc to noi dung the bang Web Speech API (bo HTML). Bam lai de dung.
export function speak(html: string) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth) return
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return
  if (synth.speaking) { synth.cancel(); return }
  synth.speak(new SpeechSynthesisUtterance(text))
}

// Render HTML cua the va to mau cac khoi <code>
export function Html({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelectorAll('code').forEach((el) => {
      const e = el as HTMLElement
      if (!e.dataset.hl) {
        try { hljs.highlightElement(e) } catch { /* bo qua */ }
        e.dataset.hl = '1'
      }
    })
  }, [html])
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
