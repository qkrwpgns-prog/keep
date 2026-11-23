-- 상대 이메일로만 서명 가능(선택)
--  expected_email: A가 지정한 상대 이메일(소문자). 있으면 그 이메일로 로그인한 계정만 상대방으로 연결된다
--  linked_hint: 연결된 상대 계정의 이메일을 가린 값(A가 누가 연결됐는지 확인용)
alter table public.parties
  add column expected_email text check (expected_email is null or expected_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column linked_hint text check (char_length(linked_hint) <= 80);

grant select (expected_email, linked_hint) on public.parties to authenticated;

create or replace function public.keep_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ev jsonb := p -> 'event';
begin
  insert into public.promises (id, share_code, template, title, amount, interest_rate, late_interest_rate, repay_account,
    item, task, deadline, method, penalty, memo, installments, amendments, status, current_hash, canonical_version,
    legacy_doc, is_demo, done_at, group_id, created_by, created_at)
  select coalesce(r.id, gen_random_uuid()), r.share_code, r.template, r.title, r.amount, r.interest_rate, r.late_interest_rate, r.repay_account,
    r.item, r.task, r.deadline, r.method, r.penalty, r.memo, coalesce(r.installments, '[]'), coalesce(r.amendments, '[]'),
    r.status, r.current_hash, coalesce(r.canonical_version, 3), r.legacy_doc, coalesce(r.is_demo, false), r.done_at, r.group_id, r.created_by,
    coalesce(r.created_at, now())
  from jsonb_populate_record(null::public.promises, p -> 'promise') r
  returning id into v_id;

  insert into public.parties (promise_id, role, user_id, display_name, signature_path, signature_sha256, signed_at,
    signer_ip, signer_ua, consent_at, consent_version, expected_email, linked_hint)
  select v_id, r.role, r.user_id, r.display_name, r.signature_path, r.signature_sha256, r.signed_at,
    r.signer_ip, r.signer_ua, r.consent_at, r.consent_version, r.expected_email, r.linked_hint
  from jsonb_array_elements(p -> 'parties') e,
       lateral jsonb_populate_record(null::public.parties, e) r;

  if v_ev is not null then
    insert into public.events (promise_id, actor_role, type, payload, canon, sim_at)
    values (v_id, v_ev ->> 'actor_role', v_ev ->> 'type', (v_ev ->> 'canon')::jsonb, v_ev ->> 'canon', (v_ev ->> 'sim_at')::date);
  end if;

  return jsonb_build_object('id', v_id, 'version', 1);
end $$;

create or replace function public.keep_commit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (p ->> 'promise_id')::uuid;
  v_row public.promises;
  v_party jsonb;
  v_ev jsonb := p -> 'event';
  v_ns jsonb := p -> 'nudge_send';
  v_hash text;
begin
  select * into v_row from public.promises where id = v_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.version <> (p ->> 'version')::int then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if p ? 'expect_status' and not (v_row.status = any (array(select jsonb_array_elements_text(p -> 'expect_status')))) then
    raise exception 'BAD_STATUS:%', v_row.status using errcode = '55000';
  end if;

  if v_ns is not null then
    insert into public.nudges (promise_id, deadline_version, stage, status, message, tone, relation, ai_used, sent_at)
    values (v_id, v_row.deadline_version, (v_ns ->> 'stage')::int, 'sent', v_ns ->> 'message', (v_ns ->> 'tone')::int,
            v_ns ->> 'relation', coalesce((v_ns ->> 'ai_used')::boolean, false), now())
    on conflict (promise_id, deadline_version, stage) do update
      set status = 'sent', message = excluded.message, tone = excluded.tone, relation = excluded.relation,
          ai_used = excluded.ai_used, sent_at = excluded.sent_at
      where public.nudges.status <> 'sent';
    if not found then raise exception 'NUDGE_ALREADY_SENT' using errcode = '23505'; end if;
  end if;

  update public.promises t set
    (template, title, amount, interest_rate, late_interest_rate, repay_account, item, task, deadline, method,
     penalty, memo, installments, amendments, status, revise_note, current_hash, canonical_version, deadline_version,
     done_at, retain_until, is_demo, demo_offset_days)
    = (select r.template, r.title, r.amount, r.interest_rate, r.late_interest_rate, r.repay_account, r.item, r.task,
        r.deadline, r.method, r.penalty, r.memo, r.installments, r.amendments, r.status, r.revise_note, r.current_hash,
        r.canonical_version, r.deadline_version, r.done_at, r.retain_until, r.is_demo, r.demo_offset_days
       from jsonb_populate_record(t, coalesce(p -> 'patch', '{}'::jsonb)) r),
    version = t.version + 1,
    updated_at = now()
  where t.id = v_id;

  for v_party in select * from jsonb_array_elements(coalesce(p -> 'parties', '[]'::jsonb)) loop
    update public.parties t set
      (user_id, display_name, signature_path, signature_sha256, signed_at, signer_ip, signer_ua, consent_at, consent_version,
       expected_email, linked_hint)
      = (select r.user_id, r.display_name, r.signature_path, r.signature_sha256, r.signed_at, r.signer_ip, r.signer_ua,
          r.consent_at, r.consent_version, r.expected_email, r.linked_hint
         from jsonb_populate_record(t, v_party) r)
    where t.promise_id = v_id and t.role = v_party ->> 'role';
  end loop;

  if p ? 'request_insert' then
    insert into public.requests (promise_id, kind, new_deadline, installments, note)
    select v_id, r.kind, r.new_deadline, r.installments, r.note
    from jsonb_populate_record(null::public.requests, p -> 'request_insert') r;
  end if;
  if p ? 'request_update' then
    update public.requests t set status = p -> 'request_update' ->> 'status', answered_at = now()
    where t.id = (p -> 'request_update' ->> 'id')::uuid and t.promise_id = v_id and t.status = 'pending';
    if not found then raise exception 'REQUEST_NOT_PENDING' using errcode = '55000'; end if;
  end if;
  if p ? 'payment_insert' then
    insert into public.payments (promise_id, amount, paid_on, installment_no, note, proof_path, ai_reading, confirmed_by_a, answered_at)
    select v_id, r.amount, r.paid_on, r.installment_no, r.note, r.proof_path, r.ai_reading, r.confirmed_by_a,
           case when r.confirmed_by_a is not null then now() end
    from jsonb_populate_record(null::public.payments, p -> 'payment_insert') r;
  end if;
  if p ? 'payment_update' then
    update public.payments t set confirmed_by_a = (p -> 'payment_update' ->> 'confirmed_by_a')::boolean, answered_at = now()
    where t.id = (p -> 'payment_update' ->> 'id')::uuid and t.promise_id = v_id and t.confirmed_by_a is null;
    if not found then raise exception 'PAYMENT_NOT_PENDING' using errcode = '55000'; end if;
  end if;

  if v_ev is not null then
    insert into public.events (promise_id, actor_role, type, payload, canon, sim_at)
    values (v_id, v_ev ->> 'actor_role', v_ev ->> 'type', (v_ev ->> 'canon')::jsonb, v_ev ->> 'canon', (v_ev ->> 'sim_at')::date)
    returning hash into v_hash;
  end if;

  return jsonb_build_object('version', v_row.version + 1, 'event_hash', v_hash);
end $$;

revoke all on function public.keep_create(jsonb), public.keep_commit(jsonb) from public, anon, authenticated;
grant execute on function public.keep_create(jsonb), public.keep_commit(jsonb) to service_role;
