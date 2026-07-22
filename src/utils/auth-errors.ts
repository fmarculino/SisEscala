export function translateAuthError(message: string | null | undefined): string {
  if (!message) return 'Ocorreu um erro inesperado. Tente novamente.'

  const msg = message.toLowerCase()

  if (msg.includes('new password should be different')) {
    return 'A nova senha deve ser diferente da senha antiga.'
  }
  if (msg.includes('password should be at least')) {
    return 'A senha deve ter no mínimo 6 caracteres.'
  }
  if (msg.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos. Verifique suas credenciais.'
  }
  if (msg.includes('email not confirmed')) {
    return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.'
  }
  if (msg.includes('user not found')) {
    return 'Usuário não encontrado.'
  }
  if (msg.includes('rate limit') || msg.includes('for security purposes')) {
    return 'Por motivos de segurança, aguarde alguns segundos antes de tentar novamente.'
  }
  if (msg.includes('token has expired') || msg.includes('auth code error') || msg.includes('invalid link')) {
    return 'O link de recuperação expirou ou é inválido. Solicite um novo link.'
  }
  if (msg.includes('same password')) {
    return 'A nova senha não pode ser igual à senha atual.'
  }

  // Se não encontrar uma tradução exata, retorna a mensagem
  return message
}
