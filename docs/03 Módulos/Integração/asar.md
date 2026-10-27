---
tipo: módulo
arquivo: src/integration/asar.js
camada: integração
testes: [test/integration/clientArchive.test.js, test/integration/host/privateArchive.test.js]
tags: [módulo]
---

# asar

> Leitor e gravador mínimo de arquivos ASAR, usado para ler o `app.asar` do Riot e gerar uma cópia com os [[addons]] anexados.

## Responsabilidade

Abre um `app.asar`, valida o cabeçalho e a árvore de entradas e lê arquivos empacotados. Gera um arquivo novo em que algumas entradas recebem um addon no final. Não extrai o arquivo para o disco e não executa nada. Não altera o arquivo de origem nem grava sobre um destino que já existe.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `MARKER` | constante | `RAM_LOGIN_INTEGRATION_V1`, o marcador inserido antes de cada addon. |
| `openArchive(file)` | função | Abre e valida o arquivo. Devolve `{ fd, header, dataOffset, size, payloadSize, entry, readFile, close }`. |
| `encodeHeader(header)` | função | Serializa o cabeçalho JSON no formato pickle do Chromium, alinhado a 4 bytes. |
| `appendToArchive(source, destination, additions, { transformers })` | função | Gera o arquivo novo e devolve os hashes de cada entrada alterada. |
| `integrityFor(bytes, previous)` | função | Calcula o bloco `integrity` (SHA256 do arquivo e por bloco). |
| `verifyIntegrity(bytes, meta)` | função | Confere o `integrity` declarado de uma entrada. Lança erro se divergir. |
| `sha256File(file)` | função | SHA-256 do arquivo físico, lido em blocos de 1 MiB. |

## Dependências

- Usa: `original-fs` dentro do Electron, `node:fs` fora dele; `crypto`.
- Usado por: [[backend]], [[status]], [[privateHostCore]], [[privateHost]], [[Scripts de integração]].

## Invariantes e decisões

- **Sempre o arquivo físico.** O Electron virtualiza caminhos que contêm `.asar`. A leitura do cabeçalho e o hash do arquivo inteiro precisam ver o arquivo real, sem mexer em `process.noAsar`. Por isso o módulo usa `original-fs` quando roda no Electron.
- **Nada é extraído nem executado.** A extensão é local e reversível: os bytes empacotados fora das entradas alteradas são preservados, assim como entradas `unpacked`, `link` e os dados de `integrity`.
- **Escrita só no final.** O conteúdo novo de cada entrada vai para o fim do payload. O `offset` antigo deixa de ser referenciado, mas os bytes antigos continuam lá. Só a entrada apontada pelo cabeçalho é executada.
- **Cada chave é um único componente de caminho.** `archivePath` rejeita caminho vazio, `/` inicial, `\`, caracteres de controle, `:`, componentes vazios, `.` e `..`. Alvos de `link` passam pela mesma regra.
- **Validação da árvore.** Profundidade máxima de 128. `size` deve ser inteiro seguro e não negativo. `offset` deve ser string só com dígitos, e `offset + size` deve caber no payload.
- **Limites fixos.** Cabeçalho até 64 MiB. Leitura e edição de uma entrada até 32 MiB (`MAX_EDIT`). Bloco de integridade padrão de 4 MiB.
- **Transformar só depois de validar.** `appendToArchive` confere o `integrity` do original antes de chamar o transformer. Os transformers são explícitos por entrada, e só podem existir para nomes presentes em `additions`.
- **Separador antes do addon.** O texto final é `original + "\n;/* RAM_LOGIN_INTEGRATION_V1 */\n" + addon + "\n"`. A quebra de linha impede que um `sourceMappingURL` ou um comentário de linha no fim do original engula o código anexado. Esse separador é a única origem do marcador: os arquivos dos [[addons]] não o contêm mais.
- **Recusa dupla aplicação.** Se a entrada original já contém o marcador, a preparação falha e pede para restaurar o original.
- **Integridade recalculada.** A entrada alterada recebe `offset`, `size` e `integrity` novos. O `blockSize` anterior é mantido. Só o algoritmo `SHA256` é aceito.
- **O candidato nunca fica ativo.** O arquivo é montado num `.tmp` aberto com `wx`, recebe `fsync` e depois é copiado com `COPYFILE_EXCL`. Isso dá semântica de "não sobrescrever" sem exigir privilégio de hard link no Windows. O `.tmp` é sempre apagado.
- **Origem e destino diferentes.** A comparação usa `path.resolve` sem diferenciar maiúsculas. O destino não pode existir.

## Testes

`clientArchive.test.js` cobre: preservação de bytes, `link` e `unpacked`; alinhamento do pickle; rejeição de travessia de caminho e de offsets fora dos limites; falha com `integrity` divergente ou algoritmo não suportado; recusa de duplicar o addon ou sobrescrever o candidato; transformers. Dois testes só rodam no Windows com o Electron instalado: o próprio Electron lê o arquivo gerado, e o parser funciona dentro do Electron sem chaves globais de ASAR. `privateArchive.test.js` usa o módulo através do script de preparação.

## Pontos de atenção

- O limite de 32 MiB por entrada vale para `main.js` e `renderer.js` do Riot. Se o bundle crescer além disso, a preparação falha. Ver [[Atualização do Riot Client]].
- A comparação entre origem e destino não resolve links simbólicos.
- O formato segue o pickle do Chromium. Uma mudança de formato no Electron do Riot quebraria a leitura.
