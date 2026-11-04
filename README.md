# MINUTIA — Sistema de Processamento de Pontos Característicos

Ferramenta web para auxiliar no confronto (comparação) de impressões digitais entre uma **Imagem Questionada** e uma **Imagem Padrão**. Todo o processamento acontece no navegador — nenhuma imagem é enviada para servidor algum.

🔗 **Site publicado:** https://invictorlopes.github.io/confronto-papiloscopico/

## Funcionalidades

- Upload local das duas imagens (Questionada / Padrão), sempre exibidas no mesmo tamanho de quadro
- Marcação de pontos em duas etapas: clique na Imagem A cria o ponto pendente, clique na Imagem B completa o par
- Arrastar qualquer ponto já marcado para reposicionar com precisão
- **Modo seta**: separa o número do ponto real, ligando os dois por uma seta — útil quando pontos estão muito próximos
- Cor customizável por par (atalhos vermelho/azul + seletor livre)
- Ocultar número de um ponto específico ou de todos de uma vez
- Tamanho do ponto e grossura da seta ajustáveis (slider ou digitando o valor)
- Lupas de precisão ao editar um ponto, mostrando a imagem A e B lado a lado, ampliadas, no mesmo enquadramento/inversão/espelhamento da imagem original
- Por imagem: zoom, rotação, espelhamento horizontal (frontal/traseira), inversão de cor (negativo) e contraste — todos com slider e campo numérico
- "Molde": sobrepõe a outra imagem semitransparente durante o ajuste, para alinhar as duas digitais visualmente
- Tema claro/escuro (detecta preferência do sistema, com opção de alternar manualmente)
- Exportação do confronto em JPEG, com caixa de diálogo para nomear o arquivo (sugestão automática com a data)
- **Sugestão de pontos (BETA)**: sugere pares de pontos entre as duas imagens para o perito conferir e adicionar (detalhes abaixo)

## Sugestão de pontos (BETA)

Ferramenta em fase BETA: as sugestões são só um apoio e a conferência é sempre do perito.

- Detecta as minúcias de cada imagem com o MINDTCT (NIST Biometric Image Software, domínio público), compilado para WebAssembly, e alinha e pareia as duas imagens com código próprio.
- Roda num Web Worker, no navegador. O código fica em `public/nbis/` (`suggest-worker.js`, `nbis.js`, `nbis.wasm`; ver `NOTICE.txt`) e a parte de interface em `src/suggest.ts` e `src/components/SuggestDialog.tsx`.
- Respeita o recorte, não repete pontos já marcados e não sugere nada quando as imagens não têm correspondência confiável (menos de 12 pares consistentes).

## Stack técnica

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/) (build e dev server)
- [Tailwind CSS v4](https://tailwindcss.com/) (`@tailwindcss/vite`)
- [lucide-react](https://lucide.dev/) (ícones)
- [html2canvas-pro](https://github.com/niklasvh/html2canvas) (exportação em JPEG — suporta as cores `oklch` do Tailwind v4)

## Rodando localmente

Pré-requisito: [Node.js](https://nodejs.org/) instalado.

```bash
git clone https://github.com/InVictorLopes/confronto-papiloscopico.git
cd confronto-papiloscopico
npm install
npm run dev
```

Abra o endereço mostrado no terminal (normalmente `http://localhost:5173`).

## Build de produção

```bash
npm run build
```

Gera os arquivos estáticos em `dist/`. O `vite.config.ts` usa `base: '/confronto-papiloscopico/'` apenas nesse build (o servidor de desenvolvimento roda na raiz, para não quebrar o hot-reload).

## Deploy

O deploy no GitHub Pages é automático: todo `git push` na branch `main` dispara o workflow em [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que builda o projeto e publica em GitHub Pages. Não é necessário nenhum passo manual além do push.

## Estrutura do projeto

```
src/
  App.tsx                  # Estado global e composição da tela
  types.ts                 # Tipos (Coordinate, Minutia, ImageTransform, ...)
  colorPalette.ts           # Cor padrão dos novos pontos
  useTheme.ts               # Hook do tema claro/escuro
  components/
    ImagePanel.tsx          # Painel de cada imagem: upload, marcação, ajuste, marcadores
    ControlPanel.tsx        # Barra de status/ações (desfazer, exportar)
    MinutiaeTable.tsx       # Tabela de pontos marcados
    Magnifier.tsx            # Lupa de precisão usada ao editar um ponto
    ExportDialog.tsx        # Caixa de diálogo para nomear o arquivo exportado
    SuggestDialog.tsx       # Sugestão de pontos (BETA): revisão dos pares sugeridos
  suggest.ts                # Prepara as imagens e conversa com o worker da sugestão
public/
  nbis/                     # Worker e WebAssembly da sugestão de pontos
```

## Privacidade

Todo o processamento (leitura de imagem, marcação, ajustes, exportação) acontece localmente no navegador via `FileReader` e `canvas`. Nenhuma imagem ou dado é enviado a qualquer servidor.
