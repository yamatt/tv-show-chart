from urllib.request import urlopen
from tempfile import NamedTemporaryFile
import gzip
from collections import namedtuple
from json import dumps, JSONEncoder
import os
from os import path
import sys

from tqdm import tqdm

class Episode(object):
    @classmethod
    def from_episode_tsv(cls, tsv, ratings):
        values = tsv.decode().strip().split("\t")
        try:
            score = float(ratings.ratings.get(values[0]))
        except ValueError:
            score = None
        except TypeError:
            score = None
        return cls(
            values[0],
            values[1],
            values[2],
            values[3],
            score
        )

    @classmethod
    def from_line(cls, episode_line, rating_line):
        return cls(
            episode_line[0],
            episode_line[1],
            episode_line[2],
            episode_line[3],
            rating_line[1]
        )

    def __init__(self, id, parent, season, episode, score):
        self.id = id
        self.parent = parent
        self.season = season
        self.episode = episode
        self.score = score

    def to_json(self):
        return {
            "id": self.id,
            "parent": self.parent,
            "season": self.season,
            "episode": self.episode,
            "score": self.score
        }

class SourceBase(object):
    URL = None
    @classmethod
    def from_download(cls, destination_file=None):
        return cls.from_url(cls.URL, destination_file)

    @classmethod
    def from_url(cls, url, destination_file=None):
        if not destination_file:
            destination_file = NamedTemporaryFile()

        response = urlopen(url)
        p = tqdm(desc=url, total=response.length, leave=False)
        while True:
            chunk = response.read(4096)
            if not chunk:
                break
            destination_file.write(chunk)
            p.update(4096)
        p.close()

        destination_file.seek(0)

        return cls.from_gz_file(destination_file)

    @classmethod
    def from_gz_path(cls, path):
        return cls.from_gz_file(open(path, "rb"))

    @classmethod
    def from_gz_file(cls, file):
        return cls(
            gzip.GzipFile(fileobj=file, mode="rb")
        )

    def __init__(self, source_file):
        self.source = source_file

    def get_id(self, id):
        while True:
            line = self.source.readline()
            if not line:
                break
            values = line.decode().strip().split("\t")
            if values[0] == id:
                return values

    def reset(self):
        self.source.seek(0)

class EpisodesSource(SourceBase):
    URL = "https://datasets.imdbws.com/title.episode.tsv.gz"

class RatingsSource(SourceBase):
    URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"

class Ratings(object):
    SOURCE=RatingsSource
    @classmethod
    def from_path(cls, path):
        return cls.from_file(
            open(path, 'rb')
        )

    @classmethod
    def from_file(cls, f):
        return cls.from_source(
            cls.SOURCE.from_gz_file(f)
        )

    @classmethod
    def from_source(cls, ratings_source):
        ratings = {}
        _ = ratings_source.source.readline() # skip first line
        while True:
            line = ratings_source.source.readline()
            if not line:
                break
            ratings_values = line.decode().strip().split("\t")
            ratings[ratings_values[0]] = ratings_values[1]
        return cls(ratings)

    def __init__(self, ratings):
        self.ratings = ratings

class Shows(object):
    EPISODE = Episode

    @classmethod
    def from_sources(cls, episodes_source, ratings):
        shows = {}
        p = tqdm(desc="Matching data", total=sum(1 for line in episodes_source.source), leave=False)
        episodes_source.source.seek(0)
        _ = episodes_source.source.readline() # skip first line

        while True:
            line = episodes_source.source.readline()
            if not line:
                break
            episode = cls.EPISODE.from_episode_tsv(line, ratings)

            if not episode.parent in shows:
                shows[episode.parent] = {}

            if not episode.season in shows[episode.parent]:
                shows[episode.parent][episode.season]=[]

            shows[episode.parent][episode.season].append(episode)
            p.update()
        p.close()
        return cls(shows)

    def __init__(self, shows):
        self.shows = shows

def main(shows):
    for show_id, seasons in tqdm(shows.shows.items(), desc="Writing data", leave=False):

        file_name = "data/{show_id}.data".format(
            show_id=show_id
        )
        with open(file_name, "w") as f:
            for season in seasons.keys():
                f.write(season + "\t")
                for episode in seasons[season]:
                    f.write("{episode_id}:{score}\t".format(
                        episode_id=episode.id,
                        score=episode.score if episode.score else "-"
                    ))
                f.write("\n")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        episodes_source = EpisodesSource.from_gz_path(sys.argv[1])
        ratings = Ratings.from_source(RatingsSource.from_gz_path(sys.argv[2]))

        shows = Shows.from_sources(episodes_source, ratings)

        main(shows)
    else:
        lambda_handler(None, None)
