# "Sem permissão para acessar a escala deste servidor" — quando a mensagem culpa o papel errado

**09/09/2026 · v2.53.2 · migration `20260909170000`**

## O relato

O usuário abriu a grade do **BLOCO B (HMI, 09/2026)**, clicou em **Ferramentas → Preencher pelas
Batidas** e recebeu:

> Sem permissão para acessar a escala deste servidor.

Ele estava logado como **Administrador Geral**, e a suspeita natural foi de papel — a ponto de o
pedido vir junto com *"os RH Geral e Unidade também devem ter essa permissão"*.

**Não era permissão, e o papel não tinha nada a ver.** `rh` e `rh_unidade` já estavam em
`fn_pode_reconciliar_presenca` desde `20260908110000`, e `super_admin` alcança qualquer escala por
construção. A mensagem é que descrevia a causa errada.

## A causa

`fn_alocar_marcacoes_dia` monta os slots candidatos a partir de **dois dias** — `p_data - 1` e
`p_data` — porque um bloco de ontem pode atravessar a meia-noite.

O guard de escopo de `fn_blocos_previstos_dia` (`20260812130000`) exige `escala_mensal` do servidor
**no mês e ano da data consultada**. No **dia 1 do mês**, a chamada do dia vizinho cai no mês
**anterior**: servidor sem escala lá faz o guard levantar `insufficient_privilege`, e a exceção
derruba a alocação inteira — **para qualquer papel logado, inclusive `super_admin`**.

Só `service_role` escapava (`auth.uid() IS NULL`).

### Por que ficou latente por um mês

Até a **v2.49.0**, toda a cadeia (`fn_reconciliar_marcacoes_dia`, `fn_conferir_reconciliacao`, a
ingestão do AFD) rodava como `service_role`. **"Preencher pelas Batidas" foi o primeiro caminho a
chamá-la com sessão de usuário** — e o defeito apareceu inteiro, no primeiro clique.

### O detalhe que provou

Os blocos **1.b (sombras)** e **1.c (irmãos)** da mesma função **já tratavam essa exceção**, com o
comentário explicando exatamente este caso:

```
-- O guard de escopo de fn_blocos_previstos_dia levanta insufficient_privilege quando o
-- servidor nao tem escala no mes do dia vizinho (dia 1 e dia 31, chamada por usuario
-- autenticado). Ai a regra do dono simplesmente nao se aplica.
```

Quem escreveu o 1.b **viu o problema e tratou ali**. O bloco 1, logo acima, ficou sem.

## O que foi medido antes de escrever código

| medição | resultado |
|---|---|
| servidores do BLOCO B com escala em 09/2026 | **21** |
| desses, com alguma escala em 08/2026 | **0** |
| `fn_reconciliacao_pendente_escala` como `service_role` | **HTTP 200**, sem erro |

O guard era a única diferença entre funcionar e falhar.

## A correção

**`fn_blocos_previstos_dia_vizinho`** — envelope que chama a original e devolve **vazio** quando o
guard recusa, em vez de propagar. O bloco 1 passou a usá-la **só para o dia vizinho**:

| dia | fonte | recusa de escopo |
|---|---|---|
| `p_data` (o consultado) | `fn_blocos_previstos_dia` | **propaga** — é ela que impede um authenticated qualquer de ler a projeção de quem não alcança |
| `p_data - 1` (o vizinho) | `fn_blocos_previstos_dia_vizinho` | **tolerada** — nenhum bloco de ontem, que é o mesmo estado de quem não tem escala lá |

Não afrouxa nada: é exatamente a decisão que os blocos 1.b e 1.c já tomavam para os **mesmos** dias
vizinhos.

⚠️ **A semântica do `WHERE` foi preservada ao pé da letra.** O original era
`WHERE d.dia_ref = p_data OR b.fim_previsto > v_meia_noite` sobre os dois dias; virou um `UNION ALL`
em que o dia consultado entra sempre e o vizinho só com `fim_previsto > v_meia_noite`. A
`ORDER BY inicio_previsto` foi para fora da subconsulta — sem isso o alinhamento monotônico do DP
receberia os slots fora de ordem.

## A conferência que provou os dois sentidos, em produção

🚨 **Migration roda como `service_role`, onde `auth.uid()` é `NULL` e o guard bypassa** — uma
conferência ingênua nunca exercitaria o caminho do defeito. A conferência **publica um JWT
sintético** com `set_config('request.jwt.claims', ..., true)` (local à transação, revertido no fim)
e mede:

| cenário | exigência |
|---|---|
| sessão de um `super_admin` real, dia 1 do mês | **aloca** — antes levantava |
| sessão com `sub` que não alcança nada | **continua recusando** — o guard do dia consultado sobreviveu |

As duas passaram na aplicação real. Sem a segunda, afrouxar o guard por engano passaria despercebido
— e abriria a projeção de qualquer servidor a qualquer autenticado, que é o que `20260812130000`
fechou.

Conferido por fora depois de aplicar:

- `fn_blocos_previstos_dia_vizinho(<servidor>, '2026-08-31')` → `200 []` (mês sem escala)
- a mesma função com a chave **anon** → **401**, `permission denied` (armadilhas 24/41)
- `fn_alocar_marcacoes_dia(<servidor>, '2026-09-01')` → `200`

## Lição

🚨 **Uma mensagem de erro que nomeia a causa errada custa mais que o defeito.** Aqui ela mandou
investigar papel, escopo e `profile_unidades` — e o usuário chegou a pedir uma permissão que já
existia. O gasto foi de diagnóstico, não de código: a correção é uma substituição.

Quando uma checagem de segurança recusa, ela sabe **que** recusou, raramente **por quê**. Se o guard
pode falhar por um motivo que não é permissão (aqui: "não há escala nesse mês"), ou a mensagem
distingue os dois, ou quem lê vai atrás do errado.

⚠️ E o corolário: **o gerador precisa detectar o EOL da fonte, não assumi-lo.** A convenção do
projeto é CRLF, mas `20260909160000` está em LF — montar o padrão de busca com o EOL errado faz a
substituição virar **no-op silencioso** e o gerador "passar" sem ter trocado nada (armadilha 48).
`gen_vizinho_tolerante.js` detecta e imprime qual encontrou.
