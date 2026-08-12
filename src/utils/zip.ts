/**
 * Escritor de .zip mínimo, sem compressão (STORE) e sem dependência nova — o binário do
 * coletor-rep já vem comprimido pelo próprio compilador Go, então DEFLATE ganharia pouco aqui
 * e implementar certo o framing de stream comprimido é bem mais arriscado de acertar sem poder
 * testar contra um leitor de zip de verdade do que gravar os bytes crus. CRC32 é obrigatório no
 * formato mesmo em STORE, então precisa existir de qualquer jeito.
 *
 * Formato: local file header + dados, um por arquivo, seguido do diretório central e do EOCD —
 * a única parte do .zip que o Windows Explorer/7-Zip realmente exigem para abrir o arquivo.
 */

interface ArquivoZip {
  nome: string
  conteudo: Buffer
}

const CRC_TABLE = (() => {
  const tabela = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    tabela[n] = c >>> 0
  }
  return tabela
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Data/hora DOS fixa (01/01/1980, 00:00) — os arquivos são gerados na hora do download, a
// data exata não importa para nada aqui, só precisa ser um valor válido no formato do zip.
const DOS_TIME = 0x0000
const DOS_DATE = 0x0021

export function criarZipSemCompressao(arquivos: ArquivoZip[]): Buffer {
  const partesLocais: Buffer[] = []
  const partesCentrais: Buffer[] = []
  let offset = 0

  for (const arquivo of arquivos) {
    const nomeBuf = Buffer.from(arquivo.nome, 'utf8')
    const crc = crc32(arquivo.conteudo)
    const tamanho = arquivo.conteudo.length

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0) // assinatura local file header
    header.writeUInt16LE(20, 4) // versao minima
    header.writeUInt16LE(0, 6) // flags
    header.writeUInt16LE(0, 8) // metodo: 0 = STORE (sem compressao)
    header.writeUInt16LE(DOS_TIME, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(tamanho, 18) // tamanho comprimido = tamanho real (STORE)
    header.writeUInt32LE(tamanho, 22) // tamanho original
    header.writeUInt16LE(nomeBuf.length, 26)
    header.writeUInt16LE(0, 28) // extra field length

    partesLocais.push(header, nomeBuf, arquivo.conteudo)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // assinatura central directory header
    central.writeUInt16LE(20, 4) // versao que criou
    central.writeUInt16LE(20, 6) // versao minima
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(0, 10) // metodo: STORE
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(tamanho, 20)
    central.writeUInt32LE(tamanho, 24)
    central.writeUInt16LE(nomeBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra field length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // numero do disco
    central.writeUInt16LE(0, 36) // atributos internos
    central.writeUInt32LE(0, 38) // atributos externos
    central.writeUInt32LE(offset, 42) // offset do local file header deste arquivo

    partesCentrais.push(central, nomeBuf)

    offset += header.length + nomeBuf.length + tamanho
  }

  const inicioCentral = offset
  const centralBuf = Buffer.concat(partesCentrais)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // assinatura end of central directory
  eocd.writeUInt16LE(0, 4) // numero deste disco
  eocd.writeUInt16LE(0, 6) // disco onde comeca o diretorio central
  eocd.writeUInt16LE(arquivos.length, 8) // entradas neste disco
  eocd.writeUInt16LE(arquivos.length, 10) // total de entradas
  eocd.writeUInt32LE(centralBuf.length, 12) // tamanho do diretorio central
  eocd.writeUInt32LE(inicioCentral, 16) // offset do diretorio central
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...partesLocais, centralBuf, eocd])
}
