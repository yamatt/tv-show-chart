import sqlite3
import sys
from pathlib import Path

import click
from tqdm import tqdm


def generate_episodes_db(
    imdb_db: str,
    output_db: str,
    min_show_votes: int,
    batch_size: int,
):
    """Extract episode data from IMDb database and create a compact episodes database."""

    click.echo(f"Loading IMDb database from {imdb_db}")
    source_conn = sqlite3.connect(imdb_db)
    source_cursor = source_conn.cursor()

    Path(output_db).parent.mkdir(exist_ok=True)
    output_conn = sqlite3.connect(output_db)
    output_cursor = output_conn.cursor()

    output_cursor.execute("DROP TABLE IF EXISTS episodes")
    output_cursor.execute("DROP TABLE IF EXISTS shows")
    output_cursor.execute("DROP TABLE IF EXISTS shows_by_name")
    output_cursor.execute(
        """
        CREATE TABLE episodes (
            id TEXT PRIMARY KEY,
            parent_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            episode_number INTEGER NOT NULL,
            name TEXT,
            score REAL
        )
    """
    )
    output_cursor.execute(
        """
        CREATE TABLE shows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            year INTEGER,
            rating REAL
        )
    """
    )
    output_cursor.execute(
        """
        CREATE TABLE shows_by_name (
            name TEXT NOT NULL,
            id TEXT NOT NULL,
            year INTEGER
        )
    """
    )
    output_cursor.execute(
        """
        CREATE INDEX idx_parent_season_ep
        ON episodes(parent_id, season, episode_number)
    """
    )
    output_cursor.execute(
        """
        CREATE INDEX idx_shows_name
        ON shows(name)
    """
    )
    output_cursor.execute(
        """
        CREATE INDEX idx_shows_by_name
        ON shows_by_name(name)
    """
    )
    output_conn.commit()

    click.echo(f"Filtering to shows with at least {min_show_votes} ratings")
    source_cursor.execute(
        """
        SELECT COUNT(*)
        FROM episodes e
        JOIN ratings show_r ON e.show_title_id = show_r.title_id
                WHERE e.show_title_id IS NOT NULL
                    AND e.season_number IS NOT NULL
                    AND e.episode_number IS NOT NULL
                    AND show_r.votes >= ?
    """,
        (min_show_votes,),
    )
    total_rows = source_cursor.fetchone()[0]
    click.echo(f"Eligible episodes: {total_rows}")

    click.echo("Populating shows table")
    source_cursor.execute(
        """
        SELECT DISTINCT
            e.show_title_id,
            t.primary_title,
            t.premiered,
            show_r.rating
        FROM episodes e
        JOIN ratings show_r ON e.show_title_id = show_r.title_id
        JOIN titles t ON e.show_title_id = t.title_id
        WHERE e.show_title_id IS NOT NULL
          AND e.season_number IS NOT NULL
          AND e.episode_number IS NOT NULL
          AND show_r.votes >= ?
        ORDER BY t.primary_title
    """,
        (min_show_votes,),
    )
    show_rows = source_cursor.fetchall()
    click.echo(f"Eligible shows: {len(show_rows)}")
    output_cursor.executemany(
        """
        INSERT INTO shows (id, name, year, rating)
        VALUES (?, ?, ?, ?)
    """,
        show_rows,
    )
    output_cursor.executemany(
        """
        INSERT INTO shows_by_name (name, id, year)
        VALUES (?, ?, ?)
    """,
        [(name, show_id, year) for show_id, name, year, _rating in show_rows],
    )
    output_conn.commit()

    source_cursor.execute(
        """
        SELECT
            e.episode_title_id,
            e.show_title_id,
            e.season_number,
            e.episode_number,
            t.primary_title,
            r.rating
        FROM episodes e
        JOIN ratings show_r ON e.show_title_id = show_r.title_id
        LEFT JOIN ratings r ON e.episode_title_id = r.title_id
        LEFT JOIN titles t ON e.episode_title_id = t.title_id
                WHERE e.show_title_id IS NOT NULL
                    AND e.season_number IS NOT NULL
                    AND e.episode_number IS NOT NULL
                    AND show_r.votes >= ?
        ORDER BY e.show_title_id, e.season_number, e.episode_number
    """,
        (min_show_votes,),
    )

    batch = []
    with tqdm(
        total=total_rows,
        desc="Importing episodes",
        unit="rows",
        file=sys.stderr,
        leave=True,
        dynamic_ncols=True,
    ) as progress:
        for row in source_cursor:
            batch.append(row)
            if len(batch) >= batch_size:
                output_cursor.executemany(
                    """
                    INSERT INTO episodes
                    (id, parent_id, season, episode_number, name, score)
                    VALUES (?, ?, ?, ?, ?, ?)
                """,
                    batch,
                )
                output_conn.commit()
                progress.update(len(batch))
                batch.clear()

        if batch:
            output_cursor.executemany(
                """
                INSERT INTO episodes
                (id, parent_id, season, episode_number, name, score)
                VALUES (?, ?, ?, ?, ?, ?)
            """,
                batch,
            )
            output_conn.commit()
            progress.update(len(batch))

    source_conn.close()
    output_conn.close()

    db_size = Path(output_db).stat().st_size
    click.echo(
        f"Episodes database created: {output_db} ({db_size / (1024 * 1024):.1f} MB)"
    )


@click.command()
@click.option("--imdb-db", default="imdb.db", show_default=True)
@click.option("--output-db", default="data/episodes.db", show_default=True)
@click.option("--min-show-votes", default=5000, show_default=True, type=int)
@click.option("--batch-size", default=10000, show_default=True, type=int)
def main(imdb_db: str, output_db: str, min_show_votes: int, batch_size: int):
    """Build a compact episode database for the chart."""
    generate_episodes_db(imdb_db, output_db, min_show_votes, batch_size)


if __name__ == "__main__":
    main()
