package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

// Verify the browser's signed bytes using the native protocol reader, without
// re-encoding JSON (Go and JavaScript escape HTML characters differently).
func TestBrowserIssueFixture(t *testing.T) {
	data, err := os.ReadFile("ts/testdata/browser-issue.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ ID, Actor, Payload, Signature string }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	signature, err := base64.RawStdEncoding.DecodeString(fixture.Signature)
	if err != nil {
		t.Fatal(err)
	}
	event, id, err := verifyEvent([]byte(fixture.Payload), signature)
	if err != nil {
		t.Fatal(err)
	}
	if id != fixture.ID || event.Actor != fixture.Actor || event.Kind != "issue.open" || event.Sequence != 1 || event.Previous != "" {
		t.Fatalf("unexpected browser issue: %s %+v", id, event)
	}
	if event.Title != "TypeScript → Hubnot 🐈" || event.Body != "Exact bytes: <>&\nSecond line." {
		t.Fatalf("browser text changed: %+v", event)
	}
}

func TestBrowserObjectFixtures(t *testing.T) {
	data, err := os.ReadFile("ts/testdata/browser-objects.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct{ ID, Actor, Payload, Signature string }
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) != 6 {
		t.Fatalf("expected six object types, got %d", len(fixtures))
	}
	for _, fixture := range fixtures {
		signature, err := base64.RawStdEncoding.DecodeString(fixture.Signature)
		if err != nil {
			t.Fatal(err)
		}
		event, id, err := verifyEvent([]byte(fixture.Payload), signature)
		if err != nil {
			t.Fatalf("browser object: %v", err)
		}
		if id != fixture.ID || event.Actor != fixture.Actor {
			t.Fatalf("object identity mismatch: %s", event.Kind)
		}
	}
}
