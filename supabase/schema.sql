-- Supabase SQL Editor에서 실행하세요.

create table if not exists public.lotto_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists lotto_members_email_unique on public.lotto_members (email);

alter table public.lotto_members enable row level security;

-- 서버(Vercel API)의 service_role 키로만 저장합니다.
-- anon/authenticated 클라이언트 직접 접근 정책은 추가하지 않습니다.
