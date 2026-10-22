import logoSrc from '../images/Logo.png'

interface LogoProps {
  size?: number
  className?: string
}

export function LogoMark({ size = 32, className = '' }: LogoProps) {
  return (
    <img
      src={logoSrc}
      width={size}
      height={size}
      alt="Zawadie"
      className={`shrink-0 object-contain ${className}`}
    />
  )
}

export function Logo({ size = 32, wordmarkClassName = '' }: LogoProps & { wordmarkClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`font-display text-[19px] font-bold tracking-tight text-text ${wordmarkClassName}`}>
        Zawadie <span className="text-accent">PromptClass</span>
      </span>
    </span>
  )
}
