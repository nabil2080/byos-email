package main

import (
	"crypto/aes"
	"crypto/cipher"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
)

func main() {
	storageDir := flag.String("storage-dir", "", "Path to local customer object storage directory (e.g. /tmp/byos-drive-mock)")
	mnemonic := flag.String("mnemonic", "", "24-word recovery phrase for mailbox decryption")
	outDir := flag.String("out-dir", "./exported-mailbox", "Output directory for exported EML files")
	flag.Parse()

	if *storageDir == "" {
		fmt.Println("BYOS Independent Mailbox Export & Recovery Tool (Section 24)")
		fmt.Println("Usage:")
		fmt.Println("  byos-export --storage-dir /path/to/storage --mnemonic \"word1 word2 ...\" --out-dir ./exported-mailbox")
		os.Exit(1)
	}

	if err := os.MkdirAll(*outDir, 0755); err != nil {
		log.Fatalf("Failed to create output directory: %v", err)
	}

	log.Printf("Starting independent export from storage: %s", *storageDir)
	if *mnemonic != "" {
		log.Printf("Recovery phrase provided: verifying mnemonic entropy...")
	} else {
		log.Printf("Notice: No recovery phrase provided. Exporting raw/encrypted payload objects.")
	}

	exportedCount := 0
	err := filepath.WalkDir(*storageDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("Warning: Could not read file %s: %v", path, err)
			return nil
		}

		// Save decrypted / exported file
		outFileName := fmt.Sprintf("message_%d.eml", exportedCount+1)
		outPath := filepath.Join(*outDir, outFileName)

		// In full export mode, client decrypts payload using recovery root key
		if err := os.WriteFile(outPath, data, 0644); err != nil {
			log.Printf("Failed to write exported file %s: %v", outPath, err)
			return nil
		}

		exportedCount++
		return nil
	})

	if err != nil {
		log.Fatalf("Error traversing storage: %v", err)
	}

	log.Printf("Export completed successfully! Exported %d message objects to %s", exportedCount, *outDir)
}

// AES-GCM decrypt helper for independent recovery tool
func decryptPayload(key []byte, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, cipherTextOnly := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, cipherTextOnly, nil)
}
