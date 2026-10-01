import type { Db } from './driver';

/**
 * Same tables / columns as the Room schema (composeApp/schemas/database.MusicDatabase/23.json).
 * Keeping the names identical keeps the door open for importing data from the Android app later.
 */
export const SCHEMA_VERSION = 23;

const TABLES = [
  'CREATE TABLE IF NOT EXISTS `Album` (`id` TEXT NOT NULL, `title` TEXT, `thumbnailUrl` TEXT, `year` TEXT, `authorsText` TEXT, `shareUrl` TEXT, `timestamp` INTEGER, `bookmarkedAt` INTEGER, PRIMARY KEY(`id`))',
  'CREATE TABLE IF NOT EXISTS `Artist` (`id` TEXT NOT NULL, `name` TEXT, `thumbnailUrl` TEXT, `timestamp` INTEGER, `bookmarkedAt` INTEGER, PRIMARY KEY(`id`))',
  'CREATE TABLE IF NOT EXISTS `Song` (`id` TEXT NOT NULL, `title` TEXT NOT NULL, `artistsText` TEXT, `durationText` TEXT, `thumbnailUrl` TEXT, `likedAt` INTEGER, `totalPlayTimeMs` INTEGER NOT NULL, PRIMARY KEY(`id`))',
  'CREATE TABLE IF NOT EXISTS `Event` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `songId` TEXT NOT NULL, `timestamp` INTEGER NOT NULL, `playTime` INTEGER NOT NULL, FOREIGN KEY(`songId`) REFERENCES `Song`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )',
  'CREATE TABLE IF NOT EXISTS `Format` (`songId` TEXT NOT NULL, `itag` INTEGER, `mimeType` TEXT, `bitrate` INTEGER, `contentLength` INTEGER, `lastModified` INTEGER, `loudnessDb` REAL, PRIMARY KEY(`songId`), FOREIGN KEY(`songId`) REFERENCES `Song`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )',
  'CREATE TABLE IF NOT EXISTS `Lyrics` (`songId` TEXT NOT NULL, `fixed` TEXT, `synced` TEXT, PRIMARY KEY(`songId`), FOREIGN KEY(`songId`) REFERENCES `Song`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )',
  'CREATE TABLE IF NOT EXISTS `Playlist` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `browseId` TEXT)',
  'CREATE TABLE IF NOT EXISTS `SearchQuery` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `query` TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `SongAlbumMap` (`songId` TEXT NOT NULL, `albumId` TEXT NOT NULL, `position` INTEGER, PRIMARY KEY(`songId`, `albumId`), FOREIGN KEY(`songId`) REFERENCES `Song`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`albumId`) REFERENCES `Album`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )',
  'CREATE TABLE IF NOT EXISTS `SongArtistMap` (`songId` TEXT NOT NULL, `artistId` TEXT NOT NULL, PRIMARY KEY(`songId`, `artistId`), FOREIGN KEY(`songId`) REFERENCES `Song`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`artistId`) REFERENCES `Artist`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )',
  'CREATE TABLE IF NOT EXISTS `SongPlaylistMap` (`songId` TEXT NOT NULL, `playlistId` INTEGER NOT NULL, `position` INTEGER NOT NULL, PRIMARY KEY(`songId`, `playlistId`), FOREIGN KEY(`songId`) REFERENCES `Song`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`playlistId`) REFERENCES `Playlist`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )',
];

const INDICES = [
  'CREATE INDEX IF NOT EXISTS `index_Event_songId` ON `Event` (`songId`)',
  'CREATE UNIQUE INDEX IF NOT EXISTS `index_SearchQuery_query` ON `SearchQuery` (`query`)',
  'CREATE INDEX IF NOT EXISTS `index_SongAlbumMap_songId` ON `SongAlbumMap` (`songId`)',
  'CREATE INDEX IF NOT EXISTS `index_SongAlbumMap_albumId` ON `SongAlbumMap` (`albumId`)',
  'CREATE INDEX IF NOT EXISTS `index_SongArtistMap_songId` ON `SongArtistMap` (`songId`)',
  'CREATE INDEX IF NOT EXISTS `index_SongArtistMap_artistId` ON `SongArtistMap` (`artistId`)',
  'CREATE INDEX IF NOT EXISTS `index_SongPlaylistMap_songId` ON `SongPlaylistMap` (`songId`)',
  'CREATE INDEX IF NOT EXISTS `index_SongPlaylistMap_playlistId` ON `SongPlaylistMap` (`playlistId`)',
];

export async function migrate(db: Db): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON;');
  for (const sql of [...TABLES, ...INDICES]) await db.exec(sql);
  await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}
