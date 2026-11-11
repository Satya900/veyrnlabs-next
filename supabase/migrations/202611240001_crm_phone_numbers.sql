-- One WhatsApp form for every way a phone number gets typed, used everywhere numbers are
-- compared (lead capture, follow-ups, welcomes, the inbox). With the workspace's country code
-- (India: 91) these are all 918127158503:
--   8127158503 · 08127158503 · +918127158503 · 918127158503 · +91 81271 58503
--   +91-0-8127158503 · 0091 8127158503 · 00918127158503 · (+91) 81271-58503
-- and a 10-digit number that happens to start with 91 is local, never cut short:
--   9127158503 -> 919127158503.
-- When a field holds several numbers ("98765 43210 / 91234 56789") the first is used.
-- Another country's number written with + or 00 is kept as is (+1 415 555 0100 -> 14155550100).
-- A number that can't be right gives null (nothing is sent): too short or long, or, for
-- India, a 91 number that isn't 91 + 10 digits starting 6-9.
begin;

create or replace function public.crm_whatsapp_number(phone text, country_code text) returns text
language plpgsql immutable set search_path='' as $$
declare raw text; d text; international boolean; national text;
begin
 if phone is null or country_code is null or country_code !~ '^[1-9][0-9]{0,3}$' then return null; end if;
 -- The first run of digits (with spaces, dots, dashes or brackets between them) long enough
 -- to be a phone number; "/", ",", ";" and words separate numbers.
 select m[1] into raw from regexp_matches(phone, '(\+?[0-9][0-9 ().-]*[0-9])', 'g') as m
 where length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 8 limit 1;
 if raw is null then
  -- Digits run together with other characters, e.g. "+91/8127158503".
  raw := phone;
 end if;
 d := regexp_replace(raw, '[^0-9]', '', 'g');
 international := raw ~ '^\s*\(?\+' or d ~ '^00';
 d := regexp_replace(d, '^00', '');
 -- Local numbers, with or without the trunk 0.
 if not international and d ~ '^0?[0-9]{10}$' then
  d := country_code || right(d, 10);
 -- Country code followed by a trunk 0: +91 0 8127158503.
 elsif d ~ ('^' || country_code || '0[0-9]{10}$') then
  d := country_code || right(d, 10);
 -- "+8127158503": a local number with a stray plus.
 elsif international and d ~ '^[0-9]{10}$' and country_code = '91' and d ~ '^[6-9]' then
  d := country_code || d;
 end if;
 if d !~ '^[1-9][0-9]{7,14}$' then return null; end if;
 -- India: 91 + a 10-digit mobile number starting 6-9.
 if left(d, 2) = '91' and country_code = '91' or (international and left(d, 2) = '91') then
  national := substr(d, 3);
  if national !~ '^[6-9][0-9]{9}$' then return null; end if;
 elsif not international and length(d) < 11 then
  return null;
 end if;
 return d;
end $$;

commit;
