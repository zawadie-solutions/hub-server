import { Download } from 'lucide-react'
import { LogoMark } from './Logo'
import { Button } from './Button'
import logoSrc from '../images/Logo.png'

interface Props {
  name: string
  score: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function drawAndDownload(name: string, score: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 800
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#1E293B'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const logo = await loadImage(logoSrc).catch(() => null)
  if (logo) {
    const size = 90
    ctx.drawImage(logo, canvas.width / 2 - size / 2, 90, size, size)
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = '#EBB019'
  ctx.font = '700 20px "Plus Jakarta Sans", sans-serif'
  ctx.fillText('CERTIFICATE OF COMPLETION', canvas.width / 2, 220)

  ctx.fillStyle = '#ffffff'
  ctx.font = '700 48px "Plus Jakarta Sans", sans-serif'
  ctx.fillText(name, canvas.width / 2, 320)

  ctx.fillStyle = '#94A3B8'
  ctx.font = '400 20px "Plus Jakarta Sans", sans-serif'
  ctx.fillText('has completed Zawadie PromptClass', canvas.width / 2, 370)
  ctx.fillText('Prompt Engineering for Zawadie Agents', canvas.width / 2, 400)

  ctx.fillStyle = '#E51A5A'
  ctx.font = '700 18px "Plus Jakarta Sans", sans-serif'
  ctx.fillText(`Total score: ${score}%`, canvas.width / 2, 460)

  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `zawadie-promptclass-certificate-${name.replace(/\s+/g, '-').toLowerCase()}.png`
  a.click()
}

export function CertificateCard({ name, score }: Props) {
  return (
    <div className="rounded-panel bg-[#1E293B] p-10 text-center text-white">
      <LogoMark size={44} className="mx-auto mb-4" />
      <div className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-warn">
        Certificate of completion
      </div>
      <div className="mb-2.5 font-display text-[26px] font-bold">{name}</div>
      <div className="mb-6 text-sm text-[#94A3B8]">
        has completed Zawadie PromptClass — Prompt Engineering for Zawadie Agents
        <br />
        Total score: {score}%
      </div>
      <Button onClick={() => drawAndDownload(name, score)}>
        <Download className="h-4 w-4" /> Download certificate
      </Button>
    </div>
  )
}
