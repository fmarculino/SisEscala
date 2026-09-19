-- Ensaio da 20260919100000 em HOMOLOGACAO. Cria um cenario sintetico, confere os DOIS sentidos
-- e REVERTE tudo com RAISE EXCEPTION no fim. Nada fica gravado.
DO $ensaio$
DECLARE
    v_disp   uuid;
    v_ger    smallint;
    v_n      integer;
    v_falta  bigint;
    v_desde  timestamptz;
    v_ok     integer := 0;
    v_falhas text := '';
    i        integer;
BEGIN
    SELECT id, geracao_atual INTO v_disp, v_ger FROM public.dispositivos_rep ORDER BY created_at LIMIT 1;
    IF v_disp IS NULL THEN RAISE EXCEPTION 'homologacao sem dispositivo para o ensaio'; END IF;

    -- Cenario: NSR 1..20 e 31..40 ingeridos; 21..30 faltando. ultimo_nsr = 40.
    FOR i IN 1..20 LOOP
        INSERT INTO public.rep_afd_registros
            (dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256, hash_encadeado, ocorrido_em, geracao)
        VALUES (v_disp, i, '3', 'ensaio-' || i, md5('ensaio-' || i), md5('cadeia-' || i),
                '2026-09-18 08:00:00-03'::timestamptz + (i || ' minutes')::interval, v_ger);
    END LOOP;
    FOR i IN 31..40 LOOP
        INSERT INTO public.rep_afd_registros
            (dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256, hash_encadeado, ocorrido_em, geracao)
        VALUES (v_disp, i, '3', 'ensaio-' || i, md5('ensaio-' || i), md5('cadeia-' || i),
                '2026-09-19 08:00:00-03'::timestamptz + (i || ' minutes')::interval, v_ger);
    END LOOP;
    UPDATE public.dispositivos_rep SET ultimo_nsr = 40 WHERE id = v_disp;

    -- 1) a lacuna aparece
    SELECT count(*), max(nsr_faltando), max(lacuna_desde)
      INTO v_n, v_falta, v_desde
      FROM public.fn_lacunas_afd_parque() WHERE dispositivo_id = v_disp;
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_falhas := v_falhas || format('[1] esperava 1 linha, veio %s; ', v_n); END IF;

    -- 2) o TAMANHO da lacuna e a distancia ate o ultimo_nsr (40 - 21 + 1 = 20), nao o buraco de 10.
    --    E deliberado: o cursor volta para o inicio do buraco, entao tudo a partir dali vai ser
    --    repedido. Dizer "faltam 10" subestimaria o que ainda precisa atravessar.
    IF v_falta = 20 THEN v_ok := v_ok + 1; ELSE v_falhas := v_falhas || format('[2] esperava 20, veio %s; ', v_falta); END IF;

    -- 3) lacuna_desde e o instante do NSR 20, o ultimo contiguo
    IF v_desde = '2026-09-18 08:00:00-03'::timestamptz + interval '20 minutes'
        THEN v_ok := v_ok + 1; ELSE v_falhas := v_falhas || format('[3] lacuna_desde=%s; ', v_desde); END IF;

    -- 4) preenchendo a lacuna, o relogio SOME da lista (o outro sentido: acusar sempre e' tao
    --    inutil quanto nunca acusar)
    FOR i IN 21..30 LOOP
        INSERT INTO public.rep_afd_registros
            (dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256, hash_encadeado, ocorrido_em, geracao)
        VALUES (v_disp, i, '3', 'ensaio-' || i, md5('ensaio-' || i), md5('cadeia-' || i),
                '2026-09-18 12:00:00-03'::timestamptz + (i || ' minutes')::interval, v_ger);
    END LOOP;
    SELECT count(*) INTO v_n FROM public.fn_lacunas_afd_parque() WHERE dispositivo_id = v_disp;
    IF v_n = 0 THEN v_ok := v_ok + 1; ELSE v_falhas := v_falhas || format('[4] relogio em dia continua listado (%s); ', v_n); END IF;

    -- 5) relogio que ainda nao entregou NSR nenhum tambem nao aparece (equipamento recem-instalado
    --    nao e lacuna). Testado zerando ultimo_nsr, nao apagando registro: rep_afd_registros e
    --    IMUTAVEL por trigger (Portaria 671/2021) e o DELETE e' recusado -- o que esta certo.
    UPDATE public.dispositivos_rep SET ultimo_nsr = 0 WHERE id = v_disp;
    SELECT count(*) INTO v_n FROM public.fn_lacunas_afd_parque() WHERE dispositivo_id = v_disp;
    IF v_n = 0 THEN v_ok := v_ok + 1; ELSE v_falhas := v_falhas || format('[5] relogio zerado listado (%s); ', v_n); END IF;

    IF v_falhas <> '' THEN RAISE EXCEPTION 'ENSAIO REPROVADO (% de 5 ok): %', v_ok, v_falhas; END IF;
    RAISE EXCEPTION 'ENSAIO OK: % de 5 cenarios passaram -- revertendo de proposito', v_ok;
END
$ensaio$;
