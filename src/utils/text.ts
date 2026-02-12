export function truncateTitle(text: string, maxLength: number): string {
	const cleaned = text.replace(/\n/g, ' ').trim();
	if (cleaned.length <= maxLength) return cleaned;
	return cleaned.substring(0, maxLength - 1) + '\u2026';
}

export function processCaption(caption: string): string {
	let html = escapeHtml(caption);

	// Link @mentions
	html = html.replace(/@([\w.]+)/g, '<a href="https://www.instagram.com/$1">@$1</a>');

	// Link #hashtags
	html = html.replace(/#([\w]+)/g, '<a href="https://www.instagram.com/explore/tags/$1">#$1</a>');

	// Newlines to <br>
	html = html.replace(/\n/g, '<br>');

	return html;
}

export function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
