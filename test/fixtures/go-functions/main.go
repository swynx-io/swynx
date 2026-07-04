package main

import "fmt"

func main() {
	fmt.Println(liveHelper())
}

func liveHelper() int {
	return usedByHelper()
}

func usedByHelper() int {
	return 42
}

func deadHelper() string {
	return "never called anywhere"
}
