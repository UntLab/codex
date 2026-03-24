import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <LoginForm
      callbackUrl={params.callbackUrl}
      authError={params.error}
    />
  );
}
