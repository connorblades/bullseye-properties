import Image from 'next/image';
import Link from 'next/link';

export function Logo({
  variant = 'dark',
  href = '/dashboard',
  size = 'md',
}: {
  variant?: 'dark' | 'white';
  href?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const src = variant === 'white' ? '/logo-white.png' : '/logo.png';
  const heights = { sm: 28, md: 80, lg: 96 };
  const h = heights[size];

  return (
    <Link href={href} className="inline-flex items-center" aria-label="Bullseye Properties">
      <Image
        src={src}
        alt="Bullseye Properties"
        width={h * 4}
        height={h}
        priority
        style={{ height: h, width: 'auto' }}
      />
    </Link>
  );
}

export function LogoIcon({
  variant = 'dark',
  size = 32,
}: {
  variant?: 'dark' | 'white';
  size?: number;
}) {
  const src = variant === 'white' ? '/icon-white.png' : '/icon.png';
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      priority
      style={{ height: size, width: size }}
    />
  );
}
