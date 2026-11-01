/** Minimal HTML → plain text without a DOM dependency. */
export function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<a\s+[^>]*href=["']mailto:([^"'>\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi, " $2 ($1) ")
    .replace(/<a\s+[^>]*href=["']tel:([^"'>\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi, " $2 ($1) ")
    // Preserve discovery links for contact pages and store locators.
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_whole, href: string, label: string) => {
      if (!/^(https?:|\/|\.\.?\/)/i.test(href)) return label;
      return ` [${label.replace(/<[^>]+>/g, " ").trim()}](${href}) `;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (entity) => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " })[entity.toLowerCase()] ?? entity)
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_entity, value: string) => {
      const code = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim();
}
