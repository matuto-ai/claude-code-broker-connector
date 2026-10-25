# Bundled Psst runtime

Unmodified runtime source from https://github.com/matuto-ai/psst at commit
ba2219cd87a1feac23e01b23d2c2b3d3bdd65359. Copyright 2026 Bruno Orsolon, MIT.
See LICENSE. src/reference-pin.mjs verifies all seven runtime source hashes
before dynamic loading. No broker checkout, npm dependency, postinstall hook,
or network fetch is needed by the installed connector.

The adapter-specific cooperative-inbox.mjs and cooperative-stdio.mjs files are
outside this vendor snapshot. They add an explicitly acknowledged application
read queue without claiming a native injection/consumption receipt.
