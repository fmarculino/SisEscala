# Mesclar cadastros duplicados de servidor (04/09/2026)

Relato do usuário, olhando `/servidores` filtrado por "maria naz":

> essa servidora foi cadastrada por engano e isso provavelmente vai acontecer novamente, preciso
> de uma opção pra mesclar casos como esse. nesse caso específico o cadastro correto é o que tem a
> matrícula 65567; outra unidade acabou cadastrando com uma matrícula temporária como se a pessoa
> tivesse duplo vínculo

## O caso

| | matrícula | criado em | unidade | `vinculo_multiplo_confirmado` |
|---|---|---|---|---|
| correto | `65567` | 25/08/2026 | USF HIROSHI MATSUDA | `false` |
| **engano** | `T2600103` | **04/09/2026** | USF Parteira Maria Bico Doce | **`true`** |

Mesmo CPF (`930.527.072-72`), mesmo cargo (técnica de enfermagem), mesmo setor.

## Por que o sistema deixou isso acontecer — e por que deve continuar deixando

`servidores` é **1 linha = 1 vínculo** por decisão de 10/08/2026 (`20260810140000`). Naquela data o
relatório do RH mostrou 110 CPFs com dois vínculos ativos **legítimos** — a mesma pessoa concursada
num cargo e contratada noutro. O índice único de CPF bloquearia a importação desses 110, então ele
foi derrubado e trocado por uma confirmação humana: `vinculo_multiplo_confirmado`.

O custo dessa troca é o caso acima. **Quem está cadastrando marca a confirmação para o sistema
deixar salvar**, e a partir daí o engano fica indistinguível do duplo vínculo de verdade.

Medido em produção em 04/09/2026, sobre 2.075 servidores:

| | |
|---|---|
| CPFs com mais de um cadastro **ativo** | **17** |
| ...com a confirmação marcada em pelo menos um lado | **17** (todos) |
| ...com uma matrícula temporária e uma definitiva | 4 |

E o que não existia era a **saída**: `/servidores/pendencias` já listava as duplicidades
(`fn_possiveis_duplicidades_servidor`) e não oferecia ação nenhuma sobre elas. É a armadilha 44
outra vez — apontar o problema sem dar o que fazer com a informação.

## O que foi medido antes de desenhar

Contando o que cada lado dos 17 grupos carrega:

| | grupos |
|---|---|
| cadastro errado **vazio** (o caso da MARIA NAZARE) | **1** |
| dado dos **dois** lados (ponto, escala, folha) | **16** |
| escala na mesma competência nos dois | 11 |
| ...no **mesmo setor** (colide na unique de `escala_mensal`) | 7 |
| escala com **slot sobreposto** no mesmo dia | 1 |

Esse quadro decidiu duas coisas, ambas confirmadas pelo usuário:

- **mover, não exigir limpeza antes.** Uma ferramenta que só aceitasse cadastro errado vazio não
  serviria para 16 dos 17 casos. E o dado do lado errado não é lixo: a pessoa bateu aquele ponto de
  verdade — a batida só foi atribuída à linha errada;
- **inativar, não excluir.** Diferente de `fn_fundir_setor` (que apaga a origem), aqui a linha
  errada carrega uma **matrícula** que pode ter sido impressa em folha, escala e relatório. Apagar
  é apagar a única explicação possível para aquele número.

## A migration (`20260904130000`)

| peça | o que faz |
|---|---|
| `servidores.mesclado_em_servidor_id` (+ `mesclado_em`, `mesclado_por`) | o rastro: para onde o cadastro foi |
| `fn_cadastros_duplicados()` | os grupos de CPF repetido, com o **peso** de cada lado |
| `fn_dependencias_servidor(uuid)` | o que está pendurado num cadastro |
| `fn_impedimentos_mesclagem_servidor(origem, destino)` | o que impede — consultado pela tela **antes** de confirmar |
| `fn_mesclar_servidores(origem, destino, motivo)` | move tudo, completa campos vazios, inativa a origem, registra em `logs_sistema` |

Todas exigem `super_admin`, todas com `REVOKE ... FROM PUBLIC, anon` na mesma migration
(armadilha 24 — `GRANT TO authenticated` nunca restringiu nada).

### O terceiro ramo do trigger de imutabilidade

`marcacoes_ponto` é INSERT-only (`20260808010000`). Os `UPDATE` liberados até aqui eram dois:
órfã → com dono (reparse de AFD) e só `setor_id` (fusão de setor). **Sem um terceiro ramo, nenhum
cadastro com batida poderia ser mesclado — e batida é justamente o que 16 dos 17 casos têm.**

O ramo novo tem a mesma forma estreita do da fusão de setor:

```sql
AND (to_jsonb(NEW) - 'servidor_id') = (to_jsonb(OLD) - 'servidor_id')
AND COALESCE(current_setting('sisescala.mesclar_servidor', true), 'off') = 'on'
```

O registro inteiro **menos** `servidor_id` tem que ser idêntico. Horário, NSR, equipamento, origem
e `sintetica` continuam impossíveis de alterar por aí — hoje e depois de a tabela ganhar coluna
nova, porque a comparação é estrutural, não uma lista de campos que envelhece. A batida muda de
dono, não de fato.

⚠️ **Os três ramos precisam sobreviver a qualquer recriação dessa função** (armadilha 1).

### O que a mesclagem recusa

1. **CPF divergente** — mesclar pessoas diferentes é o pior erro que esta ferramenta pode cometer,
   e é irreversível na prática (o ponto de uma vira ponto da outra). Também recusa quando **nenhum**
   dos dois tem CPF: sem ele não há como afirmar que são a mesma pessoa;
2. **escala sobreposta** — mesmo dia, mesma competência, slots que se cruzam. É a regra de
   `fn_prevent_cross_sector_shift_overlap` (armadilha 23) aplicada **antes** de criar o estado que
   ela existe para impedir: mover `escala_mensal.servidor_id` não passa pelo trigger, que só olha
   `escala_diaria`;
3. **colisão de unicidade** em qualquer tabela (varredura dinâmica);
4. **cadastro já mesclado**, dos dois lados.

## Duas decisões técnicas que só apareceram medindo

### A varredura de unicidade tem que ser por `pg_index`, não por `pg_constraint`

A cópia mecânica de `fn_impedimentos_fusao_setor` usaria `pg_constraint` — e **índice único parcial
não aparece lá**. Medido em 04/09/2026: **13 índices únicos** envolvem `servidor_id`, e **8 são
parciais** (`uq_profiles_servidor_id`, solicitação pendente, aviso pendente, férias não cancelada,
cadastro na fila pendente...). A conta de usuário ficaria de fora e o `UPDATE` quebraria no meio da
mesclagem.

### E o predicado do índice parcial tem que entrar na conta

A primeira versão ignorava o predicado, apostando que recusar demais é seguro. **Não é**, e em dois
lugares diferentes:

- **impedimento falso**: dois cadastros com uma solicitação de transferência **já decidida** seriam
  lidos como colisão de `idx_solicitacoes_transferencia_pendente_unica`, e a mesclagem travaria sem
  motivo;
- pior, no **descarte** de `rep_cadastros_fila` (tabela cuja duplicata é descartada, não movida): o
  `DELETE` apagaria linhas **históricas** da fila em vez de só a pendente que de fato colide.

A saída é cada lado numa subconsulta própria — as colunas nuas do predicado (`status = 'pendente'`)
resolvem no escopo mais interno e não ficam ambíguas entre `o` e `d`:

```sql
SELECT count(*) FROM (SELECT * FROM tab WHERE <pred>) o
 WHERE o.servidor_id = $1
   AND EXISTS (SELECT 1 FROM (SELECT * FROM tab WHERE <pred>) d
                WHERE d.servidor_id = $2 AND <demais colunas do índice iguais>)
```

## Complemento de campos: allowlist, nunca varredura

Ao contrário da varredura de FK — dinâmica de propósito, porque uma lista escrita à mão envelhece e
a tabela esquecida ficaria apontando para o cadastro inativado —, os **campos copiados** do cadastro
duplicado para o que fica são uma **lista explícita** de dados da pessoa (CPF, PIS, filiação, RG,
endereço, contato, registro profissional).

Aqui a assimetria se inverte: copiar por engano é pior que não copiar. Ficaram **deliberadamente de
fora** matrícula, cargo, vínculo, unidade, setor e jornada (são do *vínculo*, e o vínculo que fica é
o do destino) e dados bancários (podem ser a conta do outro contrato).

E **nunca sobrescreve**: só preenche o que está vazio no cadastro que fica. Valor divergente entre
os dois é justamente o que precisa de decisão humana.

## A tela

Nova seção **Cadastros duplicados** em `/servidores/pendencias`, só para o Administrador Geral,
acima da lista de "possíveis duplicidades" (que continua sendo leitura — ela inclui nome, telefone
e e-mail iguais, que não se resolvem mesclando).

⚠️ **A seção NÃO esconde o grupo já marcado como "vínculo duplo confirmado".** Foi exatamente uma
confirmação marcada por engano que criou o caso relatado — esconder o grupo confirmado esconderia o
que a ferramenta existe para desfazer. Ele aparece por último, rotulado, com o aviso de que duplo
vínculo legítimo **não deve** ser mesclado.

⚠️ **A sugestão de qual cadastro fica não vem pré-marcada.** Há heurística (matrícula definitiva
vence a temporária; depois, quem concentra o histórico) e ela aparece escrita com o motivo, mas o
Administrador clica olhando os dois lados. Pré-marcar transformaria a heurística em decisão — e ela
não separa nada quando as duas matrículas são temporárias, que é um caso real na base
(ANA LUCIA, `T2600020` × `T2600056`).

Com três ou mais cadastros, a mesclagem é feita **um par por vez**: juntar tudo de uma vez
esconderia no log qual foi para onde.

## O que a mesclagem NÃO resolve, e a tela diz isso

A escala movida **continua no setor onde foi lançada**. Se a unidade que cadastrou errado também
escalou a pessoa, ela passa a aparecer escalada lá, agora sob o cadastro correto — que é o que de
fato aconteceu. Quem resolve é a grade (apagar) ou mover/dividir a escala (`20260903120000`). A
mesclagem não adivinha qual escala é a "de verdade".

## Verificação

Migration validada em **homologação** (`sisescala-dev`), com ensaio revertido por `RAISE`:

| ensaio | resultado |
|---|---|
| mesclagem completa (2 batidas + 1 escala) | movidos: `escala_mensal 1`, `marcacoes_ponto 2`; origem `Inativo` apontando para o destino; `pis_pasep` e `telefone` completados; `vinculo_multiplo_confirmado` zerado |
| escala sobreposta (mesmo dia, `M` × `M`) | recusou, nomeando `9/2026 dia 5 (M x M)` |
| CPF divergente | recusou |
| GUC ligado + `UPDATE` de outra coluna da marcação | **recusou** — "Marcação de ponto e imutável" |
| SQL gerado contra os **13** índices únicos reais | 13/13 válidos, nas duas formas (contagem e descarte) |

Portão do frontend: `node scratchpad/sim_mesclagem_cadastro.js` (40 casos), validado injetando três
regressões — peso antes da matrícula definitiva, chute no empate, e o rastro da mesclagem entrando
no relato do que foi movido. As três reprovam.

---

## Adendo (mesmo dia): o primeiro uso real achou um defeito

A mesclagem da MARIA NAZARE funcionou — `T2600103` ficou Inativa apontando para `65567`. Mas a
lotação real dela é a **USF Parteira Maria Bico Doce**, e ao transferir o cadastro que ficou para
lá a tela recusou:

> Este CPF já está cadastrado para MARIA NAZARE NERES BRITO (matrícula T2600103) na unidade USF
> Parteira Maria Bico Doce. […] marque a confirmação de vínculo adicional.

**A duplicata recém-resolvida estava bloqueando o cadastro que a absorveu** — e a saída oferecida
era marcar a confirmação de vínculo adicional, *a mesma caixa* cujo uso indevido criou o problema.
Como o cadastro mesclado nunca é apagado, o bloqueio seria permanente.

A causa é o preço de inativar em vez de excluir: `fn_cpf_ja_cadastrado` (o portão de
`createServidor`/`updateServidor` desde que o índice único de CPF caiu, `20260810140000`) e
`fn_possiveis_duplicidades_servidor` olham a tabela inteira, sem distinguir cadastro vivo de
duplicata já resolvida.

`20260904140000` tira das duas quem tem `mesclado_em_servidor_id` preenchido.

⚠️ **O critério é `mesclado_em_servidor_id`, não `status = 'Inativo'`.** Servidor inativado por
exoneração continua sendo alerta legítimo ao recadastrar o mesmo CPF; quem foi *mesclado*, não —
aquele cadastro já foi declarado duplicata de outro que existe.

Validado em homologação, com o par criado e mesclado dentro do ensaio: bloqueios **1 → 0** depois
da mesclagem, e **1** de novo quando um terceiro cadastro *vivo* com o mesmo CPF entra — a checagem
não foi afrouxada demais.

### Como a transferência fica depois disso

O cadastro que ficou não tinha escala, folha nem batida (só o vínculo com o relógio da Hiroshi),
então a troca de lotação não move nada. Para o Administrador Geral a transferência é **direta**: a
lotação é gravada na hora, e a data serve ao histórico e à decisão sobre a escala — que aqui não
existe. A antecedência mínima de dias úteis (`dias_uteis_transferencia_servidor`) continua valendo
para todos os papéis, inclusive `super_admin`.
