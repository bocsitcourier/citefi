#!/usr/bin/env python3
"""Fail closed on a Redis proxy mapping; explicit internal-only is supported."""
import sys
import tomllib
import unittest
from pathlib import Path


def check(document: str) -> None:
    config = tomllib.loads(document)
    ports = config.get("ports", [])
    if not isinstance(ports, list):
        raise ValueError("ports must be an array of tables")
    redis = []
    for port in ports:
        if not isinstance(port, dict):
            raise ValueError("malformed port entry")
        local = port.get("localPort")
        if type(local) is not int or not 1 <= local <= 65535:
            raise ValueError("localPort must be an integer between 1 and 65535")
        if local == 6379:
            redis.append(port)
    if len(redis) > 1:
        raise ValueError("duplicate Redis port configuration")
    for port in redis:
        if type(port.get("localPort")) is not int:
            raise ValueError("Redis localPort must be an integer")
        if "externalPort" in port or port.get("exposeLocalhost") is not False:
            raise ValueError(
                "Redis must be explicitly internal-only: no externalPort and exposeLocalhost=false"
            )


class PolicyTests(unittest.TestCase):
    def test_no_redis_mapping(self):
        check("[[ports]]\nlocalPort=5000\nexternalPort=80\n")

    def test_explicit_internal_only(self):
        check("[[ports]]\nlocalPort=6379\nexposeLocalhost=false\n")

    def test_unsafe_and_ambiguous_mappings(self):
        entries = [
            "localPort=6379",
            "localPort=6379\nexposeLocalhost=true",
            "localPort=6379\nexternalPort=3001\nexposeLocalhost=false",
            "localPort=6379\nexternalPort=0\nexposeLocalhost=false",
            "localPort=6379\nexposeLocalhost=0",
            'localPort="6379"\nexposeLocalhost=false',
            "localPort=6379.0\nexposeLocalhost=false",
            "localPort=6379\nexposeLocalhost=false\n[[ports]]\nlocalPort=6379\nexposeLocalhost=false",
        ]
        for entry in entries:
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                check("[[ports]]\n" + entry + "\n")

    def test_malformed_configuration(self):
        for document in ["ports={localPort=6379}", "[[ports]]\nlocalPort=6379\nlocalPort=5000"]:
            with self.subTest(document=document), self.assertRaises(ValueError):
                check(document)


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        unittest.main(argv=[sys.argv[0]])
    elif len(sys.argv) == 2:
        try:
            check(Path(sys.argv[1]).read_text())
        except (ValueError, OSError) as error:
            print(f"Private Redis port gate failed: {error}", file=sys.stderr)
            sys.exit(1)
        print("Private Redis port gate passed (absent or explicitly internal-only)")
    else:
        sys.exit("Usage: check-private-redis-port.py CONFIG | --self-test")
