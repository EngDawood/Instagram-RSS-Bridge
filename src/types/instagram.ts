export interface MediaConnection {
	count: number;
	page_info: {
		has_next_page: boolean;
		end_cursor: string | null;
	};
	edges: MediaEdge[];
}

export interface MediaEdge {
	node: MediaNode;
}

export interface MediaNode {
	id: string;
	__typename: 'GraphImage' | 'GraphVideo' | 'GraphSidecar';
	shortcode: string;
	display_url: string;
	is_video: boolean;
	video_url?: string;
	taken_at_timestamp: number;
	edge_media_to_caption: {
		edges: Array<{ node: { text: string } }>;
	};
	owner: {
		id: string;
		username: string;
	};
	thumbnail_src?: string;
	edge_sidecar_to_children?: {
		edges: Array<{
			node: {
				__typename: 'GraphImage' | 'GraphVideo';
				display_url: string;
				is_video: boolean;
				video_url?: string;
			};
		}>;
	};
	dimensions?: { height: number; width: number };
}

export interface GraphQLResponse {
	data: {
		user?: {
			edge_owner_to_timeline_media: MediaConnection;
		};
		hashtag?: {
			edge_hashtag_to_media: MediaConnection;
		};
	};
	status: string;
}

export interface WebProfileInfoResponse {
	data: {
		user: {
			id: string;
			username: string;
			full_name: string;
			edge_owner_to_timeline_media: MediaConnection;
		};
	};
}

export interface TopSearchResponse {
	users: Array<{
		user: {
			pk: string;
			username: string;
			full_name: string;
			profile_pic_url: string;
			is_verified: boolean;
		};
	}>;
}

export type MediaTypeFilter = 'all' | 'video' | 'picture' | 'multiple';

export type FeedContext =
	| { type: 'username'; value: string }
	| { type: 'hashtag'; value: string }
	| { type: 'location'; value: string };

export interface TierError {
	tier: string;
	status?: number;
	message: string;
}

export interface FetchResult {
	nodes: MediaNode[];
	errors: TierError[];
}
