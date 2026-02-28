package com.englishapp.api;

import com.englishapp.service.CurrentUserService;
import com.englishapp.service.ListSentenceService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ListSentenceController {
    private final CurrentUserService currentUserService;
    private final ListSentenceService listSentenceService;

    public ListSentenceController(CurrentUserService currentUserService, ListSentenceService listSentenceService) {
        this.currentUserService = currentUserService;
        this.listSentenceService = listSentenceService;
    }

    @GetMapping("/lists")
    public List<Map<String, Object>> getLists() {
        return listSentenceService.getLists(currentUserService.getCurrentUserId());
    }

    @PostMapping("/lists")
    public Map<String, Object> createList(@RequestBody @Valid ListRequest request) {
        return listSentenceService.createList(currentUserService.getCurrentUser(), request.name());
    }

    @PutMapping("/lists/{listId}")
    public Map<String, Object> renameList(@PathVariable Long listId, @RequestBody @Valid ListRequest request) {
        return listSentenceService.renameList(currentUserService.getCurrentUserId(), listId, request.name());
    }

    @DeleteMapping("/lists/{listId}")
    public ResponseEntity<Void> deleteList(@PathVariable Long listId) {
        listSentenceService.deleteList(currentUserService.getCurrentUserId(), listId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/lists/{listId}/sentences")
    public List<Map<String, Object>> getSentences(@PathVariable Long listId) {
        return listSentenceService.getSentences(currentUserService.getCurrentUserId(), listId);
    }

    @PostMapping("/lists/{listId}/sentences")
    public Map<String, Object> addSentence(@PathVariable Long listId, @RequestBody @Valid SentenceRequest request) {
        return listSentenceService.addSentence(currentUserService.getCurrentUserId(), listId, request.content());
    }

    @PutMapping("/sentences/{sentenceId}")
    public Map<String, Object> editSentence(@PathVariable Long sentenceId, @RequestBody @Valid SentenceRequest request) {
        return listSentenceService.editSentence(currentUserService.getCurrentUserId(), sentenceId, request.content());
    }

    @DeleteMapping("/sentences/{sentenceId}")
    public ResponseEntity<Void> deleteSentence(@PathVariable Long sentenceId) {
        listSentenceService.deleteSentence(currentUserService.getCurrentUserId(), sentenceId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/sentences/{sentenceId}/move")
    public Map<String, Object> moveSentence(@PathVariable Long sentenceId, @RequestBody @Valid MoveSentenceRequest request) {
        return listSentenceService.moveSentence(
                currentUserService.getCurrentUserId(),
                sentenceId,
                request.targetListId()
        );
    }

    public record ListRequest(@NotBlank String name) {
    }

    public record SentenceRequest(@NotBlank String content) {
    }

    public record MoveSentenceRequest(@NotNull Long targetListId) {
    }
}
