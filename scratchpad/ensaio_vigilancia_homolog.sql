-- Ensaio da 20260919110000 em HOMOLOGACAO. Exercita os TRES sinais e os dois sentidos de cada um,
-- e REVERTE tudo com RAISE EXCEPTION no fim.
DO $ensaio$
DECLARE
    v_disp   uuid;
    v_ger    smallint;
    v_sev    smallint;
    v_pres   bigint;
    v_falta  bigint;
    v_mot    text;
    v_n      integer;
    v_ok     integer := 0;
    v_f      text := '';
    i        integer;
BEGIN
    SELECT id, geracao_atual INTO v_disp, v_ger FROM public.dispositivos_rep ORDER BY created_at LIMIT 1;

    -- ---------- A) LACUNA: 1..20 e 31..40 ingeridos, ultimo_nsr = 40 ----------
    FOR i IN 1..20 LOOP
        INSERT INTO public.rep_afd_registros
            (dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256, hash_encadeado, ocorrido_em, geracao)
        VALUES (v_disp, i, '3', 'ens-'||i, md5('ens-'||i), md5('c-'||i),
                '2026-09-18 08:00:00-03'::timestamptz + (i||' minutes')::interval, v_ger);
    END LOOP;
    FOR i IN 31..40 LOOP
        INSERT INTO public.rep_afd_registros
            (dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256, hash_encadeado, ocorrido_em, geracao)
        VALUES (v_disp, i, '3', 'ens-'||i, md5('ens-'||i), md5('c-'||i),
                '2026-09-19 08:00:00-03'::timestamptz + (i||' minutes')::interval, v_ger);
    END LOOP;
    UPDATE public.dispositivos_rep
       SET ultimo_nsr = 40, nsr_device = NULL, nsr_device_em = NULL, ultimo_contato_em = now()
     WHERE id = v_disp;

    SELECT severidade, nsr_faltando, batidas_presas, motivo
      INTO v_sev, v_falta, v_pres, v_mot
      FROM public.fn_vigilancia_coleta_parque() WHERE dispositivo_id = v_disp;
    IF v_sev = 2 AND v_falta = 20 THEN v_ok := v_ok+1;
    ELSE v_f := v_f || format('[A] sev=%s falta=%s; ', v_sev, v_falta); END IF;

    -- 🚨 nsr_device NULL nao pode virar 0: "nao sei" e diferente de "em dia".
    IF v_pres IS NULL THEN v_ok := v_ok+1;
    ELSE v_f := v_f || format('[A2] nsr_device NULL virou presas=%s; ', v_pres); END IF;

    -- o envelope tem que enxergar a mesma lacuna
    SELECT count(*) INTO v_n FROM public.fn_lacunas_afd_parque() WHERE dispositivo_id = v_disp;
    IF v_n = 1 THEN v_ok := v_ok+1; ELSE v_f := v_f || format('[A3] envelope viu %s; ', v_n); END IF;

    -- ---------- B) sem lacuna, mas com BATIDAS PRESAS no equipamento ----------
    FOR i IN 21..30 LOOP
        INSERT INTO public.rep_afd_registros
            (dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256, hash_encadeado, ocorrido_em, geracao)
        VALUES (v_disp, i, '3', 'ens-'||i, md5('ens-'||i), md5('c-'||i),
                '2026-09-18 12:00:00-03'::timestamptz + (i||' minutes')::interval, v_ger);
    END LOOP;
    UPDATE public.dispositivos_rep
       SET nsr_device = 45, nsr_device_em = now(), ultimo_contato_em = now() WHERE id = v_disp;

    SELECT severidade, nsr_faltando, batidas_presas, motivo
      INTO v_sev, v_falta, v_pres, v_mot
      FROM public.fn_vigilancia_coleta_parque() WHERE dispositivo_id = v_disp;
    IF v_sev = 2 AND v_falta IS NULL AND v_pres = 5 THEN v_ok := v_ok+1;
    ELSE v_f := v_f || format('[B] sev=%s falta=%s presas=%s; ', v_sev, v_falta, v_pres); END IF;
    IF v_mot LIKE '%ainda nao coletadas%' THEN v_ok := v_ok+1;
    ELSE v_f := v_f || format('[B2] motivo=%s; ', v_mot); END IF;

    -- o envelope NAO pode listar: nao ha lacuna aqui, so batida presa
    SELECT count(*) INTO v_n FROM public.fn_lacunas_afd_parque() WHERE dispositivo_id = v_disp;
    IF v_n = 0 THEN v_ok := v_ok+1; ELSE v_f := v_f || '[B3] envelope listou sem lacuna; '; END IF;

    -- ---------- C) equipamento em dia e maquina coletando: SEM sinal ----------
    UPDATE public.dispositivos_rep
       SET nsr_device = 40, nsr_device_em = now(), ultimo_contato_em = now() WHERE id = v_disp;
    SELECT severidade, batidas_presas INTO v_sev, v_pres
      FROM public.fn_vigilancia_coleta_parque() WHERE dispositivo_id = v_disp;
    IF v_sev = 0 AND v_pres IS NULL THEN v_ok := v_ok+1;
    ELSE v_f := v_f || format('[C] sev=%s presas=%s (esperava 0/NULL); ', v_sev, v_pres); END IF;

    -- ---------- D) maquina sem contato ha muito: severidade 1 ----------
    UPDATE public.dispositivos_rep
       SET ultimo_contato_em = now() - interval '20 hours' WHERE id = v_disp;
    SELECT severidade, motivo INTO v_sev, v_mot
      FROM public.fn_vigilancia_coleta_parque() WHERE dispositivo_id = v_disp;
    IF v_sev = 1 AND v_mot LIKE '%nao coleta ha%' THEN v_ok := v_ok+1;
    ELSE v_f := v_f || format('[D] sev=%s motivo=%s; ', v_sev, v_mot); END IF;

    -- ---------- E) ponto presO vence "sem contato": severidade 2, nao 1 ----------
    -- Maquina fora HA HORAS e com batida esperando e' o caso do HMI. Se a ausencia de contato
    -- mascarasse o ponto preso, o alerta diria a coisa menos grave das duas.
    UPDATE public.dispositivos_rep SET nsr_device = 60 WHERE id = v_disp;
    SELECT severidade, batidas_presas INTO v_sev, v_pres
      FROM public.fn_vigilancia_coleta_parque() WHERE dispositivo_id = v_disp;
    IF v_sev = 2 AND v_pres = 20 THEN v_ok := v_ok+1;
    ELSE v_f := v_f || format('[E] sev=%s presas=%s; ', v_sev, v_pres); END IF;

    IF v_f <> '' THEN RAISE EXCEPTION 'ENSAIO REPROVADO (% de 9 ok): %', v_ok, v_f; END IF;
    RAISE EXCEPTION 'ENSAIO OK: % de 9 cenarios passaram -- revertendo de proposito', v_ok;
END
$ensaio$;
