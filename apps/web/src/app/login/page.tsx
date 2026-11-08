import LoginForm from './login-form';
import { authConfigured } from '@/server/auth/config';

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  return <LoginForm searchParams={await searchParams} available={authConfigured()} />;
}
