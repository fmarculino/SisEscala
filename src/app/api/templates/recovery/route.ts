import { NextResponse } from 'next/server'

export async function GET() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recuperação de Senha - SisEscala</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f6f8; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 550px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08); border: 1px solid #e5e7eb;">
          
          <!-- Cabeçalho -->
          <tr>
            <td style="background-color: #1e3a8a; padding: 25px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 0.5px;">SisEscala</h1>
              <p style="color: #93c5fd; margin: 6px 0 0 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Secretaria Municipal de Saúde • Marabá-PA</p>
            </td>
          </tr>

          <!-- Corpo -->
          <tr>
            <td style="padding: 30px 30px 20px 30px; color: #374151; font-size: 15px; line-height: 1.6;">
              <h2 style="color: #111827; font-size: 18px; margin-top: 0; margin-bottom: 16px;">Recuperação de Senha</h2>
              <p style="margin-top: 0; margin-bottom: 16px;">Olá,</p>
              <p style="margin-top: 0; margin-bottom: 24px;">Recebemos uma solicitação para redefinir a senha de acesso da sua conta no sistema <strong>SisEscala</strong>.</p>
              
              <!-- Botão Principal -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto 28px auto;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #2563eb;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="font-size: 16px; font-family: Arial, sans-serif; color: #ffffff; text-decoration: none; border-radius: 8px; padding: 14px 32px; border: 1px solid #2563eb; display: inline-block; font-weight: bold;">Redefinir Minha Senha</a>
                  </td>
                </tr>
              </table>

              <!-- Código de Verificação Destacado -->
              <div style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 10px; padding: 18px; text-align: center; margin-bottom: 24px;">
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Ou use este código de verificação:</p>
                <div style="font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #1e3a8a; font-family: 'Courier New', Courier, monospace;">{{ .Token }}</div>
              </div>

              <p style="font-size: 13px; color: #6b7280; margin-bottom: 0; line-height: 1.5;">
                Se você não solicitou essa redefinição, desconsidere este e-mail com segurança. Sua senha permanecerá inalterada.
              </p>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #f3f4f6; font-size: 12px; color: #9ca3af;">
              <p style="margin: 0; font-weight: bold; color: #6b7280;">Prefeitura Municipal de Marabá • Secretaria Municipal de Saúde</p>
              <p style="margin: 4px 0 0 0;">Mensagem automática gerada pelo sistema SisEscala.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
