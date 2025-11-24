package main

import (
	"fmt"
	"time"
	"unsafe"
)

// Basic embedded field example
type Base struct {
	ID        uint64 // 8 bytes
	CreatedAt int64  // 8 bytes
}

type User struct {
	Base          // embedded: ID and CreatedAt promoted to User
	Name   string // 16 bytes
	Email  string // 16 bytes
	Active bool   // 1 byte
}

// Multiple embedded fields
type Timestamped struct {
	CreatedAt time.Time // 24 bytes
	UpdatedAt time.Time // 24 bytes
}

type Identifiable struct {
	ID   uint64 // 8 bytes
	UUID string // 16 bytes
}

type Entity struct {
	Timestamped         // embedded
	Identifiable        // embedded
	Name         string // 16 bytes
	Active       bool   // 1 byte
}

// Embedded pointer
type Metadata struct {
	Version uint32 // 4 bytes
	Flags   uint32 // 4 bytes
}

type Document struct {
	*Metadata        // embedded pointer to Metadata
	Title     string // 16 bytes
	Content   []byte // 24 bytes
	Published bool   // 1 byte
}

// Embedded with name collision
type Counter struct {
	Count uint64 // 8 bytes
}

type Stats struct {
	Counter         // embedded: Count promoted
	Total   uint64  // 8 bytes (different from embedded Count)
	Average float64 // 8 bytes
}

// Nested and embedded combination
type Address struct {
	Street  string // 16 bytes
	City    string // 16 bytes
	ZipCode uint32 // 4 bytes
}

type Contact struct {
	Email string // 16 bytes
	Phone string // 16 bytes
}

type Person struct {
	Base            // embedded
	Name    string  // 16 bytes
	Address Address // nested struct (not embedded)
	Contact         // embedded
	Age     uint8   // 1 byte
}

// Embedded interface
type Speaker interface {
	Speak() string
}

type Robot struct {
	Speaker             // embedded interface: 16 bytes (2 pointers)
	Model        string // 16 bytes
	SerialNumber uint64 // 8 bytes
	Active       bool   // 1 byte
}

// Complex real-world example
type Trackable struct {
	CreatedAt time.Time  // 24 bytes
	UpdatedAt time.Time  // 24 bytes
	DeletedAt *time.Time // 8 bytes (pointer)
}

type Article struct {
	Trackable        // embedded
	Base             // embedded
	Title     string // 16 bytes
	Content   string // 16 bytes
	AuthorID  uint64 // 8 bytes
	Published bool   // 1 byte
	ViewCount uint64 // 8 bytes
}

func main() {
	user := User{}
	entity := Entity{}
	doc := Document{}
	stats := Stats{}
	person := Person{}
	robot := Robot{}
	article := Article{}

	fmt.Printf("Base size: %d bytes\n", unsafe.Sizeof(Base{}))
	fmt.Printf("User size: %d bytes\n", unsafe.Sizeof(user))
	fmt.Printf("Entity size: %d bytes\n", unsafe.Sizeof(entity))
	fmt.Printf("Document size: %d bytes\n", unsafe.Sizeof(doc))
	fmt.Printf("Stats size: %d bytes\n", unsafe.Sizeof(stats))
	fmt.Printf("Person size: %d bytes\n", unsafe.Sizeof(person))
	fmt.Printf("Robot size: %d bytes\n", unsafe.Sizeof(robot))
	fmt.Printf("Article size: %d bytes\n", unsafe.Sizeof(article))
}
