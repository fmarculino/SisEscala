# O administrador do parque, e a exceção que nunca dispararia (25/08/2026)

## O relato

O parque de relógios passou de 6 para **14 equipamentos**. Quem administra o parque precisa estar
cadastrado, com biometria, em **todos** eles — é o que permite configurar o equipamento e cadastrar
os outros administradores. Desde 17–18/08/2026 a identidade é resolvida direto por CPF/PIS
(`fn_servidor_por_identificador_afd`), então **estar cadastrado basta para a batida virar ponto**
(armadilha 13). Cada teste de biometria numa instalação nova é uma batida real, assinada, no AFD de
um relógio onde essa pessoa não trabalha.

A defesa existia desde `20260820030000`: `rep_excecoes_ponto`, pares (servidor, dispositivo) em que
a batida não ganha dono. O problema é que ela parou de alcançar a realidade sem nunca reclamar.

## O que estava errado — duas vezes

### 1. O seed que "alcança todo relógio novo" e não alcança

O comentário do seed da `20260820030000` diz que ele é um `SELECT` sobre `dispositivos_rep`, e não
uma lista de UUID, **para que todo relógio novo já entre**. A intenção era essa; o efeito não.
`INSERT` roda uma vez: pegou os equipamentos que existiam em 20/08/2026 e nenhum dos oito criados
depois.

### 2. A primeira correção, com critério insatisfazível

`20260825120000` acrescentou um gatilho `AFTER INSERT ON dispositivos_rep` que copiava para o
equipamento novo a exceção **de quem já fosse exceção em todos os demais**. O critério parecia a
forma certa de distinguir quem administra o parque de quem tem uma exceção pontual num relógio só.

**É insatisfazível por construção.** Quem administra o parque tem, de propósito, **um** relógio sem
exceção: aquele onde o ponto dele é real. "Exceção em todos os demais" nunca vale para ele.

Medido em produção no mesmo dia — servidor mat. 69497:

| medida | valor |
|---|---|
| relógios em que estava cadastrado com biometria | 8 |
| exceções que tinha em algum desses 8 | **0** |
| exceções existentes (todas em relógios onde não está cadastrado) | 5 de 14 |
| linhas inseridas pelo backfill da `20260825120000` | **0** |

O gatilho estava vivo e não dispararia nunca. Nenhum erro, nenhuma linha, nenhum aviso.

## O desenho novo: dizer, não inferir

`20260825140000` troca a inferência por um fato declarado.

```sql
CREATE TABLE public.rep_administradores_parque (
    servidor_id          uuid PRIMARY KEY REFERENCES public.servidores(id),
    dispositivo_ponto_id uuid REFERENCES public.dispositivos_rep(id),  -- onde o ponto e' REAL
    motivo               text NOT NULL DEFAULT '...',
    created_at           timestamptz NOT NULL DEFAULT now()
);
```

O gatilho passa a criar exceção para **todo** administrador do parque a cada relógio cadastrado,
menos no `dispositivo_ponto_id` dele. Mais o backfill dos 14 que já existiam.

**A lição transferível:** quem administra o parque é um **fato administrativo**, não algo a inferir
da forma das exceções já gravadas. Inferir produziu um gatilho que nunca dispara — o pior modo de
falha possível, porque parece pronto.

⚠️ **`dispositivo_ponto_id` nunca recebe exceção.** Criar exceção ali faria o ponto real da pessoa
parar de contar — é o erro na direção contrária, e o único caro dos dois. `NULL` é válido e
significa "não bate em relógio nenhum" (alguém que só configura equipamento e registra ponto pelo
terminal).

## Medido em produção — 25/08/2026, depois de aplicar

Aplicada às 22:24 (horário de Marabá). As duas consultas de conferência da migration passam:

| conferência | resultado |
|---|---|
| relógio sem exceção, fora o próprio | **vazio** ✅ |
| exceção no próprio relógio de ponto | **vazio** ✅ |
| exceções do administrador | **13 de 13** (os 14 menos o da TI, que é o dele) |

## O que ficou para trás, e por quê

⚠️ **A exceção age na ATRIBUIÇÃO, nunca na ingestão** — e não alcança ponto já gravado.
`marcacoes_ponto` é INSERT-only e o único `UPDATE` que o gatilho libera é órfã → com dono
(`20260818001000`): **não existe caminho para tirar o dono**, e não deve existir (armadilha 20). A
porta é `marcacoes_tratamentos` com `tipo = 'desconsiderar'`, que a alocação já honra — e isso é
decisão de quem assina a folha, não efeito colateral de migration.

As batidas do administrador em relógio com exceção, conferidas uma a uma:

| quando | relógio | onde foi parar | situação |
|---|---|---|---|
| 15/08 11:24 | CEI | **entrada do Plantão** | na folha |
| 15/08 12:12 | CEI | não projetou | inerte |
| 15/08 12:41 | CEI | **retorno do intervalo** do Plantão | na folha |
| 17/08 17:08 | ENF-ZEZINHA | — | já **desconsiderada** ✅ |
| 24/08 07:33 | USF-JBB | **entrada do Regular** | na folha |
| 24/08 07:36 | USF-JBB | **saída para o intervalo** do Regular | na folha |

Ou seja: **dois dias de folha continuam com horário vindo de relógio onde o administrador só
testou** — 15/08 e 24/08, competência 08/2026, ambos em aberto. O tratamento de 17/08 mostra o
caminho e que ele funciona.

Os demais dias vieram do relógio da TI, que é o dele: legítimos, e continuam intocados.

## Verificação feita

- Migration aplicada em produção e conferida por leitura via PostgREST (as duas consultas de
  conferência 1 e 2 vêm vazias).
- 195 marcações com dono para o administrador; **6** em relógio com exceção, todas listadas acima.
- Nenhuma competência **Fechada** atingida.

## Decidido (usuário, 25/08/2026): os dois dias ficam como estão

Não haverá tratamento por migration nem por script. São dias do próprio administrador, a
competência 08/2026 está **aberta**, e o horário se corrige pela tela de validação na hora de
fechar — que é o caminho normal, feito por quem assina a folha.

⚠️ **Isso não é "deixar errado".** A correção por `marcacoes_tratamentos` continua sendo a porta
certa para o caso geral (foi o que resolveu o 17/08), e o gatilho novo garante que **nenhum dia
novo** entre assim. O que se decidiu é não mexer em ponto já gravado por script para dois dias que
a tela alcança.

## Aberto

- A tabela não tem tela: incluir/remover administrador do parque é `INSERT`/`DELETE` direto, por
  quem tem `super_admin`/`admin` (a RLS já está posta). Com um administrador só, não vale tela.
