# Turno Regular não é evento — e a troca de turno tentava justificá-lo como se fosse (10/09/2026)

**Relato do usuário:** *"na grade da escala foi colocado um turno errado MT quando faz o ajuste e
coloca M o sistema pede justificativa mas não consegue concluir o ajuste porque dá esse erro."*

Duas fotos da tela: o modal "Justificativa da alteração de turno" preenchido —
`TAMIRES GOMES VILARINS PORTILHO — dia 3 (Regular)`, `MT → M`, motivo *"HORARIO ERRADO"* — e, logo
depois, o modal vermelho:

```
Não foi possível alterar o turno

new row for relation "justificativas_eventos" violates check constraint
"justificativas_eventos_categoria_check"
```

---

## O que estava acontecendo

`fn_alterar_turno_escala_diaria` (`20260821110000`) grava o carimbo da troca em **dois** lugares, e
eles não têm o mesmo alcance:

| onde | quem escreve | alcance |
|---|---|---|
| `escala_diaria_turno_historico` | a trigger `trg_registrar_troca_turno` | **qualquer** categoria, append-only, com `de → para`, autor e `tinha_ponto` |
| `justificativas_eventos` | a própria RPC | **só evento** — a tabela tem `CHECK (categoria = ANY (ARRAY['Extra','Plantão','Sobreaviso']))` |

A RPC escrevia `p_categoria` cru. Para uma linha `Regular` o `INSERT` morria em `23514`, e como a
chamada é um statement só, **a transação inteira voltava atrás**: o `UPDATE` do turno e a linha do
histórico junto. Nada ficou pela metade — e nada foi corrigido.

O que torna isso grave não é o erro em si, é **não haver outra saída**. A célula com ponto não
aceita a troca por nenhum outro caminho: `trg_registrar_troca_turno` recusa troca de turno em dia
com ponto sem justificativa, e só esta RPC sabe publicar o texto para ela. O dia ficava congelado
com o turno errado, e o previsto contra o qual o ponto daquele dia é julgado ficava errado junto.

## Por que a categoria `Regular` não cabe naquela tabela

Não é um esquecimento da constraint. O módulo inteiro é dos eventos: a própria tela se apresenta
como *"Gestão e registro motivacional individual para Horas Extras, Plantões e Sobreavisos"*, e os
três caminhos de leitura (`fn_listar_eventos_justificaveis`, o contador de pendências e o
relatório) filtram exatamente essas três categorias.

⚠️ **A CHECK não está em migration nenhuma.** A tabela nasceu fora do versionamento, então o
`CREATE TABLE IF NOT EXISTS` de `20260805000000` — que não tem essa restrição no corpo — nunca
chegou a criá-la (armadilha 2 do `CLAUDE.md`). Confirmada por `pg_get_constraintdef` em
homologação em 10/09/2026:

```
justificativas_eventos_categoria_check
CHECK ((categoria = ANY (ARRAY['Extra'::text, 'Plantão'::text, 'Sobreaviso'::text])))
```

E confirmada por fora, empiricamente, antes de qualquer decisão: `POST` de uma linha `Regular` pelo
PostgREST devolve `23514`; as três de evento entram (e foram apagadas em seguida).

## A correção que foi descartada primeiro

**Afrouxar a CHECK para aceitar `Regular`.** É a mudança de uma linha, e está errada:

- a linha não apareceria em tela nenhuma — os três caminhos de leitura filtram evento;
- não sairia em relatório nenhum, pelo mesmo motivo;
- e ainda ocuparia a chave `uq_justificativa_evento` (servidor, dia, mês, ano, categoria).

Seria dado morto criado para satisfazer um `INSERT`. **A CHECK está certa: é o banco dizendo que
turno Regular não é evento.**

## O que foi feito

`20260910120000` — cópia mecânica de `fn_alterar_turno_escala_diaria`
(`scratchpad/gen_troca_turno_regular.js`, que aborta se qualquer contagem divergir), com o bloco
inteiro da justificativa de evento passando a viver dentro de um guard:

```sql
IF public.fn_categoria_tem_justificativa_evento(p_categoria) THEN
    ...
    v_evento_justificado := true;
END IF;
```

`fn_categoria_tem_justificativa_evento` é **espelho exato** da constraint. Não normaliza acento nem
caixa de propósito: aceitar `plantao` aqui só adiantaria o `INSERT` até a CHECK, que é literal —
trocaria um "não escreve" explícito pelo mesmo `23514`. A categoria vem do enum `escala_categoria`,
então já chega exata.

**O relato acompanha** (armadilha 22 — relatar o que mudou, nunca o que se calculou). A RPC devolve
`justificativa_evento_registrada`, e a grade parou de prometer o que não faz: o modal dizia
*"ele fica no histórico da escala e sai no relatório de Regular"*, relatório que não existe. Fonte
única dos textos em `src/utils/justificativaEvento.ts`.

## O que continua igual, e é o essencial

O motivo **nunca se perdeu de vista**: quem guarda o ato é `escala_diaria_turno_historico`,
append-only, escrito pela trigger para toda categoria. O que só existe para evento é a aparição no
relatório de justificativas. Por isso a correção é barata — não havia nada a recuperar.

## Como foi validado

- **Conferência dentro da migration**, que *executa*: a tabela-verdade da função nova, e a
  **expressão real da CHECK** lida de `pg_get_constraintdef` e avaliada com a coluna trocada pelo
  literal, abortando se as duas divergirem. Confere os dois sentidos — Regular fora, as três de
  evento dentro; fechar demais aqui apagaria a justificativa do plantão.
- **Ensaio em homologação, revertido por `RAISE EXCEPTION`, 3 de 3**: linha Regular com ponto troca
  de turno, devolve `justificativa_evento_registrada: false`, grava zero linhas em
  `justificativas_eventos` e o motivo aparece no histórico; linha Plantão continua gravando a
  justificativa de evento; e o `INSERT` direto de `Regular` continua sendo barrado pela CHECK.
- **Portões**: `scratchpad/sim_justificativa_evento.js` (36 asserções — a regra, o texto das telas
  e a estrutura da migration) e `val_sim_justificativa_evento.js`, que injeta **7 regressões** e
  exige reprovação nas 7.

## Pendência conhecida

`escala_diaria_turno_historico` não tem tela nenhuma: o motivo da troca de turno de uma linha
Regular fica registrado e auditável, mas hoje só por consulta. Se o RH precisar vê-lo, é uma aba,
não um modelo novo.
