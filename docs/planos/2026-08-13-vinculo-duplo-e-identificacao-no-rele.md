# Vínculo duplo (duas matrículas, mesmo CPF) e identificação no relógio REP

**Data:** 13/08/2026
**Origem:** preocupação levantada pelo usuário, registrada para retomar — nada decidido, nada
implementado.
**Estado:** ❓ problema aberto, sem solução escolhida.

---

## O conflito

`servidores.vinculo_multiplo_confirmado` (migration `20260810140000`) permite duas linhas em
`servidores` — duas matrículas, dois cadastros, potencialmente duas lotações (às vezes a mesma
unidade e até o mesmo setor) — para a **mesma pessoa física**, mesmo CPF. É um caso real e já
medido: 110 CPFs com vínculo ativo duplicado na base (CHANGELOG v1.42.0).

O relógio REP identifica quem bateu **só pelo CPF**: `identificador_afd` é o CPF preenchido a 12
posições (CLAUDE.md, armadilha 10), e a ponte com o servidor é `rep_vinculos_servidor`, com

```sql
CREATE UNIQUE INDEX uq_vinculo_vigente
    ON public.rep_vinculos_servidor (dispositivo_id, identificador_afd)
    WHERE vigente_ate IS NULL;
```

**Um identificador só pode ter UM vínculo vigente por dispositivo.** Não é limitação de código —
é a modelagem correta do que o hardware realmente sabe: o AFD carrega o CPF (ou o `pis`/
`registration` do device, também um-por-pessoa), nunca a matrícula. O dedo cadastrado no relógio
é o dedo da pessoa, não de uma das duas matrículas dela.

**Consequência prática:** se as duas matrículas da mesma pessoa precisam bater ponto no mesmo
relógio (mesma unidade, às vezes mesmo setor), hoje **só uma das duas** pode ter vínculo vigente.
A outra bate e a batida cai órfã (ou pior, se alguém forçar um segundo vínculo na mão, viola a
constraint) — ou pior ainda, `fn_ingerir_afd` resolve por `ORDER BY vigente_de DESC LIMIT 1`, que
silenciosamente atribuiria **toda** batida daquele CPF à matrícula errada se a constraint algum
dia fosse contornada.

## Por que isso é mais hardware do que software

Um REP-C de biometria identifica pela **digital cadastrada**, associada a um único registro no
equipamento (`pis`/`registration`/`code`, conforme o modelo — Fase 7 já mapeou isso para o
iDClass). Não há, no protocolo AFD nem na API do equipamento, um jeito de "a mesma digital
significa coisas diferentes dependendo do contexto". Qualquer solução aqui esbarra nisso antes de
esbarrar em código.

## Direções possíveis (nenhuma escolhida, nenhuma testada)

| direção | como funcionaria | risco/custo |
|---|---|---|
| **A. Relógio só p/ uma matrícula; a outra bate por terminal** | A pessoa cadastra biometria uma vez, vinculada a **uma** das duas matrículas (a que faz mais sentido, ex. a de maior carga). A outra matrícula registra presença pelo terminal `/presenca` ou `/presenca-local`, que autentica por matrícula+PIN — os dois PINs são distintos mesmo sendo a mesma pessoa, porque são registros diferentes. | Baixo risco técnico (nada novo). Custo: a pessoa usa dois fluxos diferentes pros dois vínculos, e exige decisão de "qual matrícula fica com o relógio". |
| **B. Dois cadastros no relógio, mesma digital, identificadores diferentes** | Cadastrar a mesma digital duas vezes no equipamento, uma por matrícula, com `identificador_afd` **não** baseado em CPF pra esses casos (teria que ser outra convenção, ex. matrícula normalizada). | **Não confirmado que o hardware permite.** Muitos leitores biométricos **recusam** reenrolar uma digital já conhecida (proteção contra fraude) — pode simplesmente não ser possível. Quebraria a convenção uniforme de armadilha 10 (CPF→identificador) só pra esse subconjunto. Precisa de teste de campo antes de considerar viável. |
| **C. Duas digitais diferentes (dedos diferentes) por matrícula** | Mesma ideia de B, mas contornando a proteção anti-duplicata do equipamento ao cadastrar **dedos fisicamente diferentes** para cada matrícula. | Evita o bloqueio de B, mas ainda exige `identificador_afd` não-CPF pra esses casos, e depende da pessoa lembrar qual dedo é qual matrícula — mesmo tipo de fricção operacional de A, só que pior (erro silencioso: bate com o dedo errado e a batida vai pra matrícula errada, sem aviso nenhum). |
| **D. Vínculo duplo simplesmente não usa relógio** | Política: quem tem `vinculo_multiplo_confirmado = true` fica de fora do REP por definição, os dois vínculos sempre via terminal/manual. | Mais simples e mais seguro de todos — mas tira a garantia de prova mais forte (REP-C assinado) justamente de quem tem o cadastro mais complexo de auditar. |

## O que falta pra decidir

1. **Confirmar em campo se o equipamento aceita reenrolar a mesma digital sob `registration`
   diferente** (decide se B é sequer possível) — mesmo tipo de teste que já foi feito pra
   `add_users`/`remove_users.fcgi` na Fase 7/7b, mas ninguém tentou isso ainda.
2. **Levantar quantos dos 110 CPFs com vínculo duplo têm, de fato, as duas matrículas na mesma
   unidade com relógio REP** — se for um número pequeno, A ou D resolvem sem drama; se for
   grande, vale investir em B/C.
3. Decidir se `identificador_afd` deixa de ser **sempre** CPF, ou se continua sendo a regra geral
   com uma exceção documentada pra vínculo duplo.

Nada disso foi implementado. Este documento existe só para não perder o raciocínio até a próxima
sessão.
