#!/bin/sh
# Install the repo's git hooks locally (git does not version .git/hooks).
cd "$(git rev-parse --show-toplevel)" || exit 2
cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
exec sh "$(git rev-parse --show-toplevel)/scripts/leak-scan.sh"
EOF
chmod +x .git/hooks/pre-push
echo "Installed pre-push leak scan."
