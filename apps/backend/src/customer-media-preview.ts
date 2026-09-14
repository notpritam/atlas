/** Bounded card metadata. Original bytes/text stay behind owned file endpoints. */
export type PreservedMediaPreview={
 status:string;imageCount:number;videoCount:number;excerpt:string|null;
 items:{id:string;kind:'image'|'video';url:string}[];
};
// Aliases are supplied only by our fixed SQL statements, never request input.
export function preservedMediaColumns(capture='customer_captures'){
 const owned=`capture_id=${capture}.id AND account_id=${capture}.account_id`;
 return `(SELECT json_object('status',j.status,
  'imageCount',(SELECT COUNT(*) FROM customer_media_assets WHERE ${owned} AND kind='image' AND file_path IS NOT NULL),
  'videoCount',(SELECT COUNT(*) FROM customer_media_assets WHERE ${owned} AND kind='video' AND file_path IS NOT NULL),
  'excerpt',(SELECT substr(body_text,1,480) FROM customer_media_assets WHERE ${owned} AND kind='post' ORDER BY position,id LIMIT 1),
  'items',json((SELECT json_group_array(json_object('id',id,'kind',kind,'url','/api/captures/'||capture_id||'/assets/'||id))
    FROM (SELECT id,capture_id,kind FROM customer_media_assets WHERE ${owned} AND kind IN ('image','video') AND file_path IS NOT NULL ORDER BY position,id LIMIT 4))))
  FROM customer_preservation_jobs j WHERE j.capture_id=${capture}.id AND j.account_id=${capture}.account_id) AS preserved_media_json`;
}
