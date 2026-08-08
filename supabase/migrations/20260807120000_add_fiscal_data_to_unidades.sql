-- Migration: Adiciona dados fiscais e responsavel legal ao cadastro de unidades
-- Data: 2026-08-07
--
-- MOTIVACAO
--   O relogio de ponto (REP-C Control iD) exige o registro do Empregador na propria memoria:
--   CNPJ, razao social e CPF do responsavel. Esses dados sao gravados no AFD como registro
--   tipo 2 e aparecem no cabecalho do arquivo. Hoje eles foram carregados manualmente no
--   equipamento de teste; para que a integracao possa gerar essa carga a partir do SisEscala
--   - e para que o sistema possa emitir AFD/AEJ no futuro - a unidade precisa carregar
--   os proprios dados.
--
--   O CNPJ e sempre o do Fundo Municipal de Saude (18478187000107), mas a coluna fica na
--   unidade em vez de uma configuracao global porque a SMS ja opera unidades com CNPJ proprio
--   e o layout da Portaria 671 e por estabelecimento, nao por orgao.
--
-- FORMATO
--   cnpj e responsavel_cpf guardam SOMENTE DIGITOS. A formatacao (pontos, barra, traco) e
--   responsabilidade da UI. Isso evita o problema que existe hoje em servidores.cpf, que
--   guarda o valor formatado e por isso nao casa em comparacao direta com o identificador
--   de 12 digitos que vem do AFD.
--
-- IDEMPOTENTE
--   ADD COLUMN IF NOT EXISTS porque os schemas de homologacao e producao divergem
--   (CLAUDE.md armadilha 3). As CHECK constraints entram via DO block com verificacao previa
--   em pg_constraint, ja que ALTER TABLE ADD CONSTRAINT nao aceita IF NOT EXISTS.
--   Rodar nos dois ambientes e seguro.

ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS cnpj text;

ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS razao_social text;

ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS responsavel_nome text;

ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS responsavel_cpf text;

ALTER TABLE public.unidades
    ADD COLUMN IF NOT EXISTS responsavel_cargo text;


-- Constraints de formato. Como as colunas acabaram de ser criadas, toda linha existente
-- tem NULL nos campos e as constraints validam sem varredura relevante.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_unidade_cnpj'
           AND conrelid = 'public.unidades'::regclass
    ) THEN
        ALTER TABLE public.unidades
            ADD CONSTRAINT chk_unidade_cnpj
            CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_unidade_responsavel_cpf'
           AND conrelid = 'public.unidades'::regclass
    ) THEN
        ALTER TABLE public.unidades
            ADD CONSTRAINT chk_unidade_responsavel_cpf
            CHECK (responsavel_cpf IS NULL OR responsavel_cpf ~ '^[0-9]{11}$');
    END IF;
END
$$;


COMMENT ON COLUMN public.unidades.cnpj IS
    'CNPJ do estabelecimento, somente digitos (14). Vai para o registro tipo 2 do AFD.';

COMMENT ON COLUMN public.unidades.razao_social IS
    'Razao social do empregador. Quando vazia, a integracao com o REP usa nome da unidade + setor.';

COMMENT ON COLUMN public.unidades.responsavel_nome IS
    'Nome do responsavel legal pelo controle de ponto da unidade.';

COMMENT ON COLUMN public.unidades.responsavel_cpf IS
    'CPF do responsavel legal, somente digitos (11). Vai para o registro tipo 2 do AFD.';

COMMENT ON COLUMN public.unidades.responsavel_cargo IS
    'Cargo/funcao do responsavel legal. Informativo, nao vai para o AFD.';


-- CONFERENCIA APOS APLICAR
--   1) Deve retornar as cinco colunas novas:
--
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'unidades'
--      AND column_name IN ('cnpj', 'razao_social', 'responsavel_nome',
--                          'responsavel_cpf', 'responsavel_cargo')
--    ORDER BY column_name;
--
--   2) Deve retornar as duas constraints:
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.unidades'::regclass
--      AND conname IN ('chk_unidade_cnpj', 'chk_unidade_responsavel_cpf');
--
--   3) O formato so-digitos deve rejeitar valor mascarado:
--
--   -- deve falhar:
--   -- UPDATE public.unidades SET cnpj = '18.478.187/0001-07' WHERE false;
