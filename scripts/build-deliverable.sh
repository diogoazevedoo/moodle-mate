#!/usr/bin/env bash
# build-deliverable.sh — render a draft.md into a submittable document via pandoc.
#
# Usage:
#   build-deliverable.sh <dir> [docx|pdf|both]
#
#   <dir>     directory containing draft.md (typically workspace/<deliverableId>/)
#   format    docx | pdf | both   (default: docx)
#
# Behavior:
#   - Input is <dir>/draft.md.
#   - If <dir>/templates/reference.docx exists, it is used as the DOCX style
#     reference (--reference-doc).
#   - If <dir>/styles/apa.csl AND <dir>/refs.bib both exist, citations are
#     processed with --citeproc --csl styles/apa.csl --bibliography refs.bib.
#   - docx  -> <dir>/out.docx
#   - pdf   -> <dir>/out.pdf  (via --pdf-engine=xelatex)
#   - both  -> both of the above.
#
# pandoc and xelatex are expected to be installed on this machine.

set -euo pipefail

DIR="${1:-}"
FORMAT="${2:-docx}"

if [[ -z "$DIR" ]]; then
  echo "usage: build-deliverable.sh <dir> [docx|pdf|both]" >&2
  exit 2
fi
if [[ ! -d "$DIR" ]]; then
  echo "error: directory not found: $DIR" >&2
  exit 1
fi
case "$FORMAT" in
  docx|pdf|both) ;;
  *) echo "error: format must be 'docx', 'pdf', or 'both' (got '$FORMAT')" >&2; exit 2 ;;
esac
if ! command -v pandoc >/dev/null 2>&1; then
  echo "error: pandoc is not installed or not on PATH" >&2
  exit 1
fi

DRAFT="$DIR/draft.md"
if [[ ! -f "$DRAFT" ]]; then
  echo "error: no draft.md found in $DIR" >&2
  exit 1
fi

# Run pandoc from inside <dir> so relative paths resolve consistently.
cd "$DIR"

COMMON_OPTS=()
if [[ -f "styles/apa.csl" && -f "refs.bib" ]]; then
  COMMON_OPTS+=(--citeproc --csl "styles/apa.csl" --bibliography "refs.bib")
  echo "Using citations: --csl styles/apa.csl --bibliography refs.bib"
fi

PRODUCED=()

build_docx() {
  local docx_opts=("${COMMON_OPTS[@]}")
  if [[ -f "templates/reference.docx" ]]; then
    docx_opts+=(--reference-doc "templates/reference.docx")
    echo "Using DOCX reference: templates/reference.docx"
  fi
  pandoc "draft.md" "${docx_opts[@]}" -o "out.docx"
  PRODUCED+=("$DIR/out.docx")
}

build_pdf() {
  local pdf_opts=("${COMMON_OPTS[@]}")
  pdf_opts+=(--pdf-engine=xelatex)
  pandoc "draft.md" "${pdf_opts[@]}" -o "out.pdf"
  PRODUCED+=("$DIR/out.pdf")
}

case "$FORMAT" in
  docx) build_docx ;;
  pdf)  build_pdf ;;
  both) build_docx; build_pdf ;;
esac

echo "Produced:"
for f in "${PRODUCED[@]}"; do echo "  $f"; done
