-- Da eseguire UNA volta nel SQL Editor di Supabase dopo le migrazioni.
-- Sostituisci i due valori tra < >. Il segreto deve essere identico a DISPATCH_SECRET delle Edge Functions.
select vault.create_secret('https://<ID-PROGETTO>.supabase.co/functions/v1/push-dispatch', 'dispatch_url');
select vault.create_secret('<STESSO-VALORE-DI-DISPATCH_SECRET>', 'dispatch_secret');

-- Facoltativo: codice invito per entrare nel gruppo senza approvazione
-- update public.app_settings set invite_code = 'giovedi2026';
