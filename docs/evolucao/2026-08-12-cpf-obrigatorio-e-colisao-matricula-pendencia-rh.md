# CPF obrigatório no cadastro + colisão por matrícula na promoção de pendência de RH — 12/08/2026

## Contexto

O usuário reportou, com print da tela, que promover a pendência de importação do RH de FLAVIA
BARROS CAVALCANTE (matrícula 58144, DMAC) estourava um erro cru de Postgres:

```
duplicate key value violates unique constraint "servidores_matricula_key"
```

FLAVIA já está cadastrada e ativa na escala do DMAC — a pendência é um resíduo da importação
original (v1.42.0), que não conseguiu casar o vínculo dela do relatório do RH com o cadastro que
já existia no SisEscala. Junto com o print, o usuário pediu para tornar o CPF obrigatório no
cadastro do servidor, considerando a situação de vínculo duplo.

## Diagnóstico

`fn_promover_pendencia_rh` só detecta conflito com um cadastro existente por um caminho: CPF
(`fn_cpf_ja_cadastrado`). Se a pendência não tem CPF preenchido — ou o cadastro ativo também não
tem (57 servidores em produção, em 08/2026) — essa checagem nunca dispara, e a função tenta o
`INSERT` direto. Só então a constraint única de matrícula reage, e o erro que chega na tela é o
do Postgres, cru, sem nenhuma orientação.

Diferente do CPF — onde duas pessoas podem legitimamente compartilhar o documento por vínculo
múltiplo (v1.42.0, uma pessoa com dois cargos/matrículas) — colisão por **matrícula nunca é um
segundo vínculo válido**. Matrícula é a própria chave que a fila de pendências usa para decidir
"esta pessoa ainda não tem cadastro": se já existe alguém com essa matrícula, é sempre o MESMO
registro, e a única ação correta é atualizar, nunca criar de novo.

## O que foi construído

### 1. CPF obrigatório no cadastro do servidor

`createServidor`, `updateServidor` e a importação em massa por CSV passam a recusar CPF vazio —
nova função `validarCpfObrigatorio` em `servidores/actions.ts`. `CampoDocumento` do CPF ganhou
`required` em `servidores/novo/page.tsx` e `EditServidorForm.tsx`.

**Não é retroativo**: servidor legado sem CPF não é bloqueado de imediato, só na próxima vez que
alguém salvar o cadastro dele — mesmo padrão já usado para o `CHECK` de dígito verificador
(v1.38.0/20260809230000), que corrigiu os inválidos existentes antes de travar novos.

**Vínculo duplo não conflita com isto.** O segundo vínculo é a mesma pessoa com o MESMO CPF,
diferenciado só pela confirmação explícita (`confirma_vinculo_adicional`). CPF obrigatório na
verdade fortalece essa checagem: antes dela, um segundo vínculo cadastrado sem CPF nenhum
escapava por completo de `verificarCpfDuplicado`.

### 2. Colisão por matrícula na promoção de pendência (migration `20260812110000`)

| peça | o que faz |
|---|---|
| `fn_servidor_por_matricula` (nova) | mesmo padrão `SECURITY DEFINER` de `fn_cpf_ja_cadastrado` — acha o cadastro ativo com esta matrícula, se houver |
| `fn_promover_pendencia_rh` | checa matrícula **antes** de CPF; colisão vira `RAISE EXCEPTION` direcionando pra "atualizar cadastro existente" — nunca aceita `confirma_vinculo_adicional` pra isso |
| `fn_atualizar_cadastro_via_pendencia_rh` | ganha `p_cpf` opcional; passa a preencher `cpf` do cadastro existente por `COALESCE` — antes ficava de fora do `UPDATE` porque só era alcançada quando já tinha casado por CPF (logo já preenchido) |
| `buscarConflitoPendencia` (renomeada de `buscarConflitoCpf`) | verifica matrícula e CPF numa chamada só, devolve `tipo: 'matricula' \| 'cpf'` e o CPF que a pendência já traz |
| `LinhaPendente` (`ImportacaoRhSection.tsx`) | conflito por matrícula mostra só "atualizar cadastro existente" (sem radio); conflito por CPF mantém as duas opções de sempre |

⚠️ **`CREATE OR REPLACE` não substitui função quando a lista de parâmetros muda de tamanho** — cria
uma segunda função (overload) e deixa a assinatura antiga viva e desatualizada ao lado da nova.
A migration usa `DROP FUNCTION IF EXISTS` explícito nas duas funções antes de recriá-las com o
parâmetro novo (`p_cpf`).

### 3. CPF obrigatório também na criação via pendência

`fn_promover_pendencia_rh` (criar cadastro novo) passa a exigir CPF igual ao cadastro manual —
vem do CPF que a pendência já traz do relatório do RH ou, na falta dele, de um campo novo
(`CampoDocumento`) na própria linha da tela, sem que o coordenador precise ir a outro lugar.
`fn_atualizar_cadastro_via_pendencia_rh` (completar existente) é mais permissiva de propósito —
CPF ali é só best-effort (`COALESCE`), nunca bloqueia a atualização, porque essa é justamente a
válvula de escape pra destravar uma pendência presa quando nem a pendência nem o cadastro
existente têm CPF nenhum.

## O que já funcionava e não precisou de mudança

"À medida que os cadastros forem sendo atualizados eles têm que sair das pendências" — já era o
comportamento existente. `promovido_em` (setado tanto por `fn_promover_pendencia_rh` quanto por
`fn_atualizar_cadastro_via_pendencia_rh`) tira a linha da fila `WHERE promovido_em IS NULL`
assim que a promoção ou atualização é confirmada.

## Correção da correção (mesmo dia, v1.56.1)

Testando esta própria mudança em produção, "Atualizar cadastro existente" da pendência da FLAVIA
passou a recusar com `Este CPF não corresponde mais ao cadastro informado`. Causa: a pendência
dela tem um CPF preenchido, mas **diferente** do CPF gravado no cadastro ativo — a colisão real é
só por matrícula. `fn_atualizar_cadastro_via_pendencia_rh` revalidava o conflito exigindo sempre
que `fn_cpf_ja_cadastrado` batesse com o `servidor_id` recebido — regra herdada do fluxo antigo
(conflito só por CPF), nunca adaptada para o novo caminho de matrícula.

Corrigido em `20260812120000`: a revalidação tenta `fn_servidor_por_matricula` primeiro — se
bater, segue direto, sem checar CPF nenhum. Só cai para `fn_cpf_ja_cadastrado` quando a matrícula
não aponta para o `servidor_id` recebido (o caso original).

## Verificação

- `npx tsc --noEmit` / `npm run build`.
- Migration aplicada pelo usuário primeiro em homologação, depois produção.
- Conferência sugerida na própria migration: achar uma pendência cuja matrícula já existe em
  `servidores` e reabrir a linha na tela — espera-se o aviso vermelho de "cadastro ativo com esta
  matrícula", não mais o erro cru de constraint.
