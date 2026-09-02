# Terminal Local e de Presença: Suporte ao PIN de 6 a 8 Dígitos

**Data:** 02/09/2026  
**Versão:** 2.34.1  
**Autor:** Equipe SisEscala

---

## 1. Contexto e Problema

Com a evolução das regras de segurança de PIN (migração `20260830170000` e utilitário `src/utils/pin.ts`), novos PINs individuais passaram a ser gerados e exigidos no padrão de **6 a 8 dígitos** (`PIN_MIN_DIGITOS = 6` e `PIN_MAX_DIGITOS = 8`).

Entretanto, as telas de registro de ponto mantinham restrições legadas no frontend:
- **Terminal Local (`/presenca-local`)**: O campo de PIN continha `maxLength={4}` e `placeholder="••••"`, impedindo que servidores com os novos PINs de 6 dígitos conseguissem digitar sua senha para bater o ponto.
- **Terminal Clássico (`/presenca`)**: Mesma limitação com `maxLength={4}` e `placeholder="••••"`.
- **Portal do Servidor e Gestão de Servidores**: Placeholders e limites fixos em 4 ou 6 dígitos sem refletir o `PIN_MAX_DIGITOS`.

---

## 2. Correções Aplicadas

1. **Terminal Local (`src/app/presenca-local/page.tsx`)**:
   - `maxLength` atualizado para `PIN_MAX_DIGITOS` (8 dígitos), suportando PINs legados de 4 dígitos e novos PINs de 6 a 8 dígitos.
   - `placeholder` atualizado para `••••••`.
   - `tracking` ajustado de `[1em]` fixo para `[0.5em] sm:tracking-[0.75em]` garantindo legibilidade e evitando estouro de layout em telas menores.

2. **Terminal de Presença Clássico (`src/app/presenca/page.tsx`)**:
   - `maxLength` atualizado para `PIN_MAX_DIGITOS`.
   - `placeholder` atualizado para `••••••`.
   - `tracking` ajustado para `[0.5em] sm:tracking-[0.75em]`.

3. **Formulários de Edição e Cadastro de Servidor (`EditServidorForm.tsx` e `servidores/novo/page.tsx`)**:
   - `maxLength` sincronizado com `PIN_MAX_DIGITOS`.
   - `placeholder` ajustado para `"Ex: 123456"`.

4. **Portal do Servidor (`ConsultarEscalaClient.tsx` e `TrocarPinSection.tsx`)**:
   - Placeholders e espaçamentos alinhados ao padrão de 6 dígitos.

---

## 3. Validação

- `npm run build` executado com sucesso (zero erros de tipagem e geração de páginas estáticas concluída).
- Verificada a compatibilidade do backend com bcrypt para verificação de PINs de qualquer tamanho entre 4 e 8 dígitos.
