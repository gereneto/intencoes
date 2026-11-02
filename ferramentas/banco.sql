-- Intenções: o banco. Rodar uma vez, inteiro, no SQL Editor do projeto Supabase
-- próprio do app (não é o do Calendário CCI).
--
-- Cada "Rezei" é uma linha em `rezas`; a contagem de uma intenção é
-- contagem_inicial + a soma das linhas dela. Nada se soma por diferença, então
-- dois celulares não têm como descasar. O app só acrescenta linhas: não altera
-- nem apaga reza nenhuma.
--
-- Acesso: só a conta compartilhada (e-mail fixo em SUPA_EMAIL, no app.js),
-- com a senha digitada uma vez em cada celular.

create or replace function public.eh_dono() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'intencoes@taioe.com.br'
$$;

-- ── intenções ──
-- contagem_inicial: o que cada uma já tinha quando o banco nasceu (veio do
-- celular que fez a primeira carga). Instantes em milissegundos (Date.now()).
create table public.intencoes (
  id               text primary key,
  pessoa           text   not null default '' check (char_length(pessoa) <= 200),
  oracao           text   not null default '' check (char_length(oracao) <= 500),
  frequencia       int    not null default 1  check (frequencia between 1 and 100),
  contagem_inicial int    not null default 0,
  criado_em        bigint not null default 0,
  editado_em       bigint not null default 0,
  apagada_em       bigint
);

-- ── textos das orações, um por nome ──
create table public.textos (
  nome       text primary key check (char_length(nome) <= 500),
  texto      text   not null default '',
  editado_em bigint not null default 0
);

-- ── cada reza é uma linha ──
-- id vem do celular (uuid): reenviar a mesma reza não a duplica.
-- quantidade é 1 no "Rezei"; outro número no ajuste à mão da contagem e na
-- soma das rezas recuperadas de um celular (origem diz qual).
create table public.rezas (
  id          uuid primary key,
  intencao_id text        not null,
  quantidade  int         not null default 1,
  em          timestamptz not null default now(),
  aparelho    text        not null default '',
  origem      text        not null default 'rezei'
);
create index rezas_por_intencao on public.rezas (intencao_id);

-- ── cópia inteira do que um celular guardava ──
-- Enviada ao entrar com a senha, antes de o celular mexer em qualquer coisa,
-- e pelo botão "Enviar cópia ao banco". É daqui que se recupera o que só um
-- aparelho tinha.
create table public.copias (
  id       bigint generated always as identity primary key,
  aparelho text        not null default '',
  motivo   text        not null default '',
  em       timestamptz not null default now(),
  conteudo jsonb       not null
);

-- ── total de rezas por intenção ──
create view public.contagens with (security_invoker = true) as
  select intencao_id, sum(quantidade)::int as total
  from public.rezas
  group by intencao_id;

-- ── edição mais recente vence; apagada fica apagada ──
-- (Para desfazer uma exclusão pelo SQL Editor:
--  alter table public.intencoes disable trigger intencoes_regras; … enable …)
create or replace function public.intencoes_regras() returns trigger
language plpgsql as $$
begin
  if old.apagada_em is not null then
    return old;
  end if;
  if new.apagada_em is not null then
    old.apagada_em := new.apagada_em;
    old.editado_em := greatest(old.editado_em, new.editado_em);
    return old;
  end if;
  if new.editado_em < old.editado_em then
    return old;
  end if;
  -- nascer é uma vez só; e a carga inicial não se reescreve pelo app
  if old.criado_em > 0 and (new.criado_em = 0 or new.criado_em > old.criado_em) then
    new.criado_em := old.criado_em;
  end if;
  new.contagem_inicial := old.contagem_inicial;
  return new;
end $$;

create trigger intencoes_regras before update on public.intencoes
  for each row execute function public.intencoes_regras();

create or replace function public.textos_regras() returns trigger
language plpgsql as $$
begin
  if new.editado_em < old.editado_em then
    return old;
  end if;
  return new;
end $$;

create trigger textos_regras before update on public.textos
  for each row execute function public.textos_regras();

-- ── quem pode o quê ──
alter table public.intencoes enable row level security;
alter table public.textos    enable row level security;
alter table public.rezas     enable row level security;
alter table public.copias    enable row level security;

revoke all on public.intencoes, public.textos, public.rezas, public.copias, public.contagens
  from anon, authenticated;

grant select, insert, update on public.intencoes, public.textos to authenticated;
grant select, insert         on public.rezas, public.copias     to authenticated;
grant select                 on public.contagens                to authenticated;

create policy dono_le      on public.intencoes for select to authenticated using (public.eh_dono());
create policy dono_cria    on public.intencoes for insert to authenticated with check (public.eh_dono());
create policy dono_altera  on public.intencoes for update to authenticated using (public.eh_dono()) with check (public.eh_dono());

create policy dono_le      on public.textos for select to authenticated using (public.eh_dono());
create policy dono_cria    on public.textos for insert to authenticated with check (public.eh_dono());
create policy dono_altera  on public.textos for update to authenticated using (public.eh_dono()) with check (public.eh_dono());

create policy dono_le      on public.rezas for select to authenticated using (public.eh_dono());
create policy dono_cria    on public.rezas for insert to authenticated with check (public.eh_dono());

create policy dono_le      on public.copias for select to authenticated using (public.eh_dono());
create policy dono_cria    on public.copias for insert to authenticated with check (public.eh_dono());
