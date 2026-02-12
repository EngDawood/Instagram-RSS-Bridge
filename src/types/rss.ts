export interface RSSItem {
	uri: string;
	author: string;
	title: string;
	content: string;
	enclosures: string[];
	thumbnail?: string;
	timestamp: number;
}

export interface RSSFeed {
	title: string;
	link: string;
	description: string;
	items: RSSItem[];
}
