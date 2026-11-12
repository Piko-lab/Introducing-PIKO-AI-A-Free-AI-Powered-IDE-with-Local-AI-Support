import logo from '../assets/logo.png'

export function AppLogo({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src={logo}
      alt="PIKO AI"
      width={size}
      height={size}
      className={className}
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        position: 'relative',
        zIndex: 1,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />
  )
}
