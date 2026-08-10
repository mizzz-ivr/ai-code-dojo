export function buildPageWindow(currentPage, totalPages, maxItems = 5) {
  const start = currentPage - Math.floor(maxItems / 2);
  return Array.from({ length: maxItems }, (_, index) => start + index)
    .filter((page) => page >= 1 && page <= totalPages);
}
